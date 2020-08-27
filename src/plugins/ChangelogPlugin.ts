import chalk from "chalk";
import { Message, TextChannel } from "discord.js";
import { Command, ImportApi } from "../core/Api";
import { Plugin } from "../core/Plugin";
import { sleep } from "../util/Async";
import { hours, seconds } from "../util/Time";
import { ChangeType, ITrelloCard, IVersionInfo, Trello } from "../util/Trello";


/**
 * Set this variable to true and allow the plugin to update once to save that the bot has reported all possible changes.
 * This is useful when the api changes.
 */
const skipLog = false;

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

export interface IChangelogData {
	reportedChanges: string[];
}

export interface IChangelogConfig {
	reportingChannel: string;
	reportedLists?: string[];
	warningChannel?: string;
	warningChangeCount?: number;
}

export class ChangelogPlugin extends Plugin<IChangelogConfig, IChangelogData> {
	public updateInterval = hours(1);

	private channel: TextChannel;
	private warningChannel?: TextChannel;
	private isReporting = false;
	private reportedChanges: string[];
	private continueReport?: (report: boolean) => any;

	@ImportApi("trello")
	private trello: Trello = undefined!;

	public getDefaultId () {
		return "changelog";
	}

	public async onStart () {
		this.reportedChanges = this.getData("reportedChanges", []);
	}

	public async onUpdate () {
		if (this.isReporting) {
			return;
		}

		// this.log("Updating changelog...");
		this.channel = this.guild.channels.find(channel => channel.id === this.config.reportingChannel) as TextChannel;
		this.warningChannel = !this.config.warningChannel ? undefined
			: this.guild.channels.find(channel => channel.id === this.config.warningChannel) as TextChannel;

		const versions = await this.trello.getActiveVersions();

		this.isReporting = true;

		for (const version of versions)
			await this.changelog(version);

		if (this.config.reportedLists)
			for (const list of this.config.reportedLists)
				await this.changelog(list);

		this.isReporting = false;

		// this.log("Update complete.");
		this.save();
	}

	@Command<ChangelogPlugin>("changelog confirm")
	protected confirmChangelog (message: Message) {
		this.continueLogging(message, true);
		return true;
	}

	@Command<ChangelogPlugin>("changelog skip")
	protected skipChangelog (message: Message) {
		this.continueLogging(message, false);
		return true;
	}

	private continueLogging (message: Message, report: boolean) {
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
			?.filter(card => !this.reportedChanges.includes(card.id));

		if (!changes?.length)
			return;

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
					...changes.map(change => `> \`ID ${change.id}\` ${this.generateChangeTypeEmojiPrefix(change)} ${change.name}`));
			}

			report = await new Promise<boolean>(resolve => this.continueReport = resolve);
		}

		changes.sort((a, b) => new Date(a.dateLastActivity).getTime() - new Date(b.dateLastActivity).getTime());

		for (const card of changes)
			await this.handleChange(version, card, report);
	}

	private async handleChange (version: IVersionInfo | string, card: ITrelloCard, report: boolean) {
		this.reportedChanges.push(card.id);
		await this.save();

		if (skipLog)
			return;

		let change = this.generateChangeTypeEmojiPrefix(card);
		change += typeof version === "string" ? "" : ` [${version.strPretty}]`;
		change += ` ${card.name} ${card.shortUrl}`;

		this.logger.info(`${report ? "Reporting" : "Skipping"} change: ${change}`);

		if (report) {
			this.channel.send(change);
			await sleep(seconds(5));
		}

	}

	private generateChangeTypeEmojiPrefix (card: ITrelloCard) {
		let result = "";

		card.labels.sort((a, b) => changeOrder.indexOf(a.name as ChangeType) - changeOrder.indexOf(b.name as ChangeType));
		for (const label of card.labels) {
			const emoji = this.getEmoji(label.name as ChangeType);
			if (emoji) {
				result += emoji;
			}
		}

		return result;
	}

	private getEmoji (emote: ChangeType) {
		if (!emotes[emote]) {
			return undefined;
		}

		return this.guild.emojis.find(emoji => emoji.name === emotes[emote]);
	}
}
