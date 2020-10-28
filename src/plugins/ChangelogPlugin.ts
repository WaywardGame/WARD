import chalk from "chalk";
import { Message, RichEmbed, TextChannel, User } from "discord.js";
import { Command, CommandMessage, CommandResult, ImportApi } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Plugin } from "../core/Plugin";
import Strings from "../util/Strings";
import { hours } from "../util/Time";
import { ChangeType, ITrelloCard, IVersionInfo, Trello } from "../util/Trello";

const emotes: { [key: string]: string } = {
	[ChangeType.New]: "new",
	[ChangeType.Improvement]: "improvement",
	[ChangeType.Bug]: "bug",
	[ChangeType.Balance]: "balance",
	[ChangeType.Modding]: "modding",
	[ChangeType.Mod]: "mod",
	[ChangeType.Technical]: "technical",
	[ChangeType.Internal]: "internal",
	[ChangeType.Regression]: "regression",
	[ChangeType.Refactor]: "refactor",
	[ChangeType.Performance]: "performance",
	[ChangeType.Guide]: "guide",
};

const changeOrder = [
	ChangeType.New,
	ChangeType.Improvement,
	ChangeType.Bug,
	ChangeType.Balance,
	ChangeType.Modding,
	ChangeType.Guide,
	ChangeType.Mod,
	ChangeType.Performance,
	ChangeType.Technical,
	ChangeType.Internal,
	ChangeType.Regression,
	ChangeType.Refactor,
];

const colors = {
	pink: "#FF27DC",
	yellow: "#FFD800",
	lime: "#B6FF00",
	blue: "#0094FF",
	black: "#999999",
	orange: "#FF8C00",
	red: "#FF0000",
	purple: "#C447FF",
	sky: "#A1DFE2",
	green: "#38D567",
};

const changelogVersion = 10;

type ReportedChange = [trelloId: string, textHash: number, messageId?: string];

export interface IChangelogData {
	reportedChanges: ReportedChange[];
}

export interface IChangelogConfig {
	reportingChannel: string;
	reportedLists?: string[];
	warningChannel?: string;
	warningChangeCount?: number;
}

enum CommandLanguage {
	ChangelogDescription = "If too many changes happen at once, the bot pauses in case something happened so that it doesn't spam. The following are commands provided in case this occurs.",
	ChangelogConfirmDescription = "This command *confirms* printing the changelog.",
	ChangelogSkipDescription = "This command *skips* printing the changelog.",
}

export class ChangelogPlugin extends Plugin<IChangelogConfig, IChangelogData> {
	public updateInterval = hours(1);

	private channel: TextChannel;
	private warningChannel?: TextChannel;
	private isReporting = false;
	private get reportedChanges () { return this.data.reportedChanges; }
	private continueReport?: (report: boolean) => any;

	@ImportApi("trello")
	private trello: Trello = undefined!;

	protected initData = () => ({ reportedChanges: [] });

	public getDefaultId () {
		return "changelog";
	}

	public async onUpdate () {
		if (this.isReporting)
			return;

		this.channel = this.guild.channels.find(channel => channel.id === this.config.reportingChannel) as TextChannel;
		this.warningChannel = !this.config.warningChannel ? undefined
			: this.guild.channels.find(channel => channel.id === this.config.warningChannel) as TextChannel;

		try {
			const versions = await this.trello.getActiveVersions();

			this.isReporting = true;

			for (const version of versions)
				await this.changelog(version);

			if (this.config.reportedLists)
				for (const list of this.config.reportedLists)
					await this.changelog(list);
		} catch (err) {
			this.logger.error("Cannot fetch changelog", err.message || err);
		}

		this.isReporting = false;
	}

	public getDescription () {
		return "A plugin for reporting changes as seen on a Trello board.";
	}

	public isHelpVisible (author: User) {
		return this.guild.members.get(author.id)
			?.permissions.has("ADMINISTRATOR")
			?? false;
	}

	private readonly help = new HelpContainerPlugin()
		.setDescription(CommandLanguage.ChangelogDescription)
		.addCommand("changelog confirm", CommandLanguage.ChangelogConfirmDescription)
		.addCommand("changelog skip", CommandLanguage.ChangelogSkipDescription);

	@Command(["help changelog", "changelog help"])
	protected async commandHelp (message: CommandMessage) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return CommandResult.pass();

		this.reply(message, this.help);
		return CommandResult.pass();
	}

	@Command<ChangelogPlugin>("changelog confirm")
	protected confirmChangelog (message: CommandMessage) {
		this.continueLogging(message, true);
		return CommandResult.pass();
	}

	@Command<ChangelogPlugin>("changelog skip")
	protected skipChangelog (message: CommandMessage) {
		this.continueLogging(message, false);
		return CommandResult.pass();
	}

	private continueLogging (message: CommandMessage, report: boolean) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return;

		if (!this.continueReport) {
			this.reply(message, `No changelog to ${report ? "confirm" : "skip"} report of.`);
			return;
		}

		this.reply(message, `Reporting changelog ${report ? "confirmed" : "skipped"}.`);
		this.logger.info(`Reporting changelog ${report ? "confirmed" : "skipped"} by ${message.member.displayName}.`);

		this.continueReport?.(report);
		delete this.continueReport;
	}

	private async changelog (version: IVersionInfo | string) {
		const changelog = await this.trello.getChangelog(version);
		const changes = changelog?.unsorted
			?.filter(card => !this.reportedChanges.some(([trelloId]) => trelloId === card.id));

		if (changes?.length)
			await this.handleNewChanges(changes, version);

		for (const card of changelog?.unsorted || []) {
			const reportedChange = this.reportedChanges.find(([trelloId]) => trelloId === card.id) || [];
			if (!reportedChange) {
				// this shouldn't be possible but just in case
				this.logger.warning(`Trying to verify hash of reported change, but cannot find it in the reported list. Skipping & assuming it was reported previously.\n\tChange: ${card.name} (${card.shortUrl})`);
				await this.handleChange(version, card, false);
				continue;
			}

			const [, textHash, messageId] = reportedChange;
			const change = this.getChangeText(version, card);
			const newHash = Strings.hash(`${change} ${changelogVersion}`);
			// console.log(`${!!messageId}`.padStart(5), `${newHash}`.padStart(12), `${textHash}`.padStart(12), change);
			if (newHash !== textHash) {
				this.logger.info(`Updating change: ${change}`);

				if (messageId) {
					const message = await this.getMessage(this.channel, messageId);

					if (message)
						await message.edit("", await this.getChangeEmbed(version, card));

					else
						this.logger.warning("The change message is inaccessible or no longer exists.");
				}

				reportedChange[1] = newHash;
				this.data.markDirty();
			}
		}
	}

	private async handleNewChanges (changes: ITrelloCard[], version: IVersionInfo | string) {
		let report = true;
		if (changes.length > (this.config.warningChangeCount || Infinity) && !this.continueReport) {
			const warning = [
				`Trying to report ${chalk.yellowBright(`${changes.length} changes`)}. A changelog exceeding ${chalk.yellowBright(`${this.config.warningChangeCount} changes`)} must be manually confirmed.\nTo proceed send command ${chalk.cyan("!changelog confirm")}, to skip send ${chalk.cyan("!changelog skip")}`,
				...changes.map(change => `${chalk.grey(`ID ${change.id}`)} ${change.name}`),
			];
			this.logger.warning(warning.join("\n\t"));

			if (this.warningChannel) {
				this.sendAll(this.warningChannel,
					`Trying to report **${changes.length} changes**. A changelog exceeding **${this.config.warningChangeCount} changes** must be manually confirmed.`,
					"To proceed send command `!changelog confirm`, to skip send `!changelog skip`",
					...changes.map(change => `> \`ID ${change.id}\` ${this.getChangeTypeEmojis(change).map(([emoji]) => emoji).join("")} ${change.name}`));
			}

			report = await new Promise<boolean>(resolve => this.continueReport = resolve);
		}

		changes.sort((a, b) => new Date(a.dateLastActivity).getTime() - new Date(b.dateLastActivity).getTime());

		for (const card of changes)
			await this.handleChange(version, card, report);
	}

	private async handleChange (version: IVersionInfo | string, card: ITrelloCard, report: boolean) {
		const change = this.getChangeText(version, card);
		this.logger.info(`${report ? "Reporting" : "Skipping"} change: ${change}`);

		const reportedChange: ReportedChange = [card.id, Strings.hash(`${change} ${changelogVersion}`)];
		this.reportedChanges.push(reportedChange);

		if (report)
			reportedChange[2] = (await this.channel.send("", await this.getChangeEmbed(version, card)) as Message).id;

		this.data.markDirty();
	}

	private getChangeText (version: IVersionInfo | string, card: ITrelloCard) {
		let change = this.getChangeTypeEmojis(card).map(([emoji]) => emoji).join("");
		change += typeof version === "string" ? "" : ` [${version.strPretty}]`;
		change += ` ${card.name} ${card.shortUrl}`;
		return change;
	}

	private async getChangeAuthor (card: ITrelloCard): Promise<Parameters<RichEmbed["setAuthor"]>> {
		const members = await this.trello.getMembers(card.id);
		if (!members.length)
			return [];

		if (members.length === 1)
			return [members[0].fullName, `${members[0].avatarUrl}/50.png`];

		return [members.map(member => member.fullName).join(", ")];
	}

	private async getChangeEmbed (version: IVersionInfo | string, card: ITrelloCard) {
		const description = this.getChangeTypeEmojis(card)
			.map(([emoji, changeType]) => `${emoji} ${Strings.sentence(changeType)}`);

		if (typeof version !== "string")
			description.push(version.strPretty);

		description.push(`[View on Trello](${card.shortUrl})`);

		return new RichEmbed()
			.setColor(colors[this.getChangeTypeLabels(card)[0].color as keyof typeof colors])
			.setAuthor(...await this.getChangeAuthor(card))
			.setDescription(card.name + "\n\n" + description.join(" \u200B · \u200B "));
	}

	private getChangeTypeEmojis (card: ITrelloCard) {
		return this.getChangeTypeLabels(card)
			.map(label => {
				const emoji = this.getEmoji(label.name as ChangeType);
				return emoji && [emoji, label.name] as const;
			})
			.filterNullish();
	}

	private getChangeTypeLabels (card: ITrelloCard) {
		return card.labels
			.sort((a, b) => changeOrder.indexOf(a.name as ChangeType) - changeOrder.indexOf(b.name as ChangeType));
	}

	private getEmoji (emote: ChangeType) {
		if (!emotes[emote]) {
			return undefined;
		}

		return this.guild.emojis.find(emoji => emoji.name === emotes[emote]);
	}
}
