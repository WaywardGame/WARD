import { GuildMember, Message, TextChannel, User } from "discord.js";
import { Command, CommandMessage, ImportPlugin } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Plugin } from "../core/Plugin";
import Bound from "../util/Bound";
import { RegularsPlugin } from "./RegularsPlugin";


export type IGiveawayPluginConfig = {
	channel: string;
	userLock?: {
		talent: number;
		days: number;
	};
}

export interface IGiveawayData {
	giveaway?: IGiveawayInfo;
}

interface IGiveawayInfo {
	winnerCount: number;
	message: string;
	prize?: number;
	consolation?: number;
}

enum CommandLanguage {
	GiveawayStartDescription = "Starts a new giveaway. The giveaway will persist until it is ended or cancelled. Users can enter the giveaway by reacting to the announcement message.",
	GiveawayStartArgumentWinnerCount = "The number of entrants that should win the giveaway. Must be a positive integer.",
	GiveawayStartArgumentText = "Text that will be printed as part of the giveaway announcement message. **Note:** By default, the message does not ping any users. If you'd like users to be pinged, include an `@everyone` in this, and send the giveaway command via DMs so it doesn't ping anyone.",
	GiveawayEndDescription = "Ends the giveaway, pinging all of the winners in an announcement message.",
	GiveawayCancelDescription = "Cancels the current giveaway. The announcement message will *not* be deleted automatically.",
	GiveawayRedrawDescription = "Redraws winners for the giveaway announced with the given message.",
	GiveawayRedrawArgumentAnnouncementMessageId = "The ID of the message used to announce the giveaway. (The one that people add reactions to.) You can get the ID by right clicking the message and choosing \"Copy ID\".",
	GiveawayRedrawArgumentWinnerCount = "The number of entrants that should win the giveaway. Must be a positive integer.",
	GiveawayRedrawArgumentPrize = "The prize to give to the winner(s).",
	GiveawayRedrawArgumentConsolation = "The consolation prize to give anyone that doesn't win.",
	GiveawayInfoDescription = "Lists the current entrants for the currently-running giveaway.",
	GiveawayInfoAnnouncementMessageId = "The announcement message of the giveaway to return the entrants of. If not provided, lists the entrants of the currently running giveaway.",
	GiveawayPrizeDescription = "Sets the grand/consolation prize for anyone that doesn't win the currently-running giveaway.",
	GiveawayPrizeArgumentAmount = "The grand/consolation prize given to all winners/losers. If not provided, removes the prize.",
	GiveawayPrizeArgumentPrize = "Modifies the grand prize (for winners)",
	GiveawayPrizeArgumentConsolation = "Modifies the consolation prize (for losers)",
}

export class GiveawayPlugin extends Plugin<IGiveawayPluginConfig, IGiveawayData> {
	private channel: TextChannel;
	private giveaway?: IGiveawayInfo;

	@ImportPlugin("regulars")
	private regularsPlugin: RegularsPlugin = undefined!;

	public getDefaultId () {
		return "giveaway";
	}

	public getDescription () {
		return "A plugin for creating & managing giveaways.";
	}

	public isHelpVisible (author: User) {
		return this.guild.members.get(author.id)
			?.permissions.has("ADMINISTRATOR")
			?? false;
	}

	private readonly help = new HelpContainerPlugin()
		.addCommand("giveaway", CommandLanguage.GiveawayStartDescription, command => command
			.addArgument("winnerCount", CommandLanguage.GiveawayStartArgumentWinnerCount, argument => argument
				.setDefaultValue(1))
			.addArgument("text", CommandLanguage.GiveawayStartArgumentText, argument => argument
				.setOptional()))
		.addCommand("giveaway end", CommandLanguage.GiveawayEndDescription)
		.addCommand("giveaway cancel", CommandLanguage.GiveawayCancelDescription)
		.addCommand("giveaway redraw", CommandLanguage.GiveawayRedrawDescription, command => command
			.addArgument("announcementMessageId", CommandLanguage.GiveawayRedrawArgumentAnnouncementMessageId)
			.addArgument("winnerCount", CommandLanguage.GiveawayRedrawArgumentWinnerCount, argument => argument
				.setDefaultValue(1))
			.addArgument("prize", CommandLanguage.GiveawayRedrawArgumentPrize, argument => argument
				.setOptional())
			.addArgument("consolation", CommandLanguage.GiveawayRedrawArgumentConsolation, argument => argument
				.setOptional()))
		.addCommand("giveaway info", CommandLanguage.GiveawayInfoDescription, command => command
			.addArgument("announcementMessageId", CommandLanguage.GiveawayInfoAnnouncementMessageId, argument => argument
				.setOptional()))
		.addCommand("giveaway", CommandLanguage.GiveawayPrizeDescription, command => command
			.addRawTextArgument("prize", CommandLanguage.GiveawayPrizeArgumentPrize, argument => argument
				.addOption("consolation", CommandLanguage.GiveawayPrizeArgumentConsolation))
			.addArgument("amount", CommandLanguage.GiveawayPrizeArgumentAmount, argument => argument
				.setOptional()));

	@Command(["help giveaway", "giveaway help"])
	protected async commandHelp (message: Message) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		this.reply(message, this.help);
		return true;
	}

	public async onStart () {
		this.channel = this.guild.channels.find(channel => channel.id === this.config.channel) as TextChannel;
		this.giveaway = this.getData("giveaway", undefined);
	}

	// tslint:disable cyclomatic-complexity
	@Command("giveaway")
	protected async commandStartGiveaway (message: Message, winnerCount: string | number = 1, ...giveawayText: string[]) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		winnerCount = +winnerCount;
		if (winnerCount <= 0) {
			this.reply(message, "invalid winner count, must be an integer greater than 0.");
			return false;
		}

		if (this.giveaway) {
			this.reply(message, "there is already a giveaway, please finish or cancel the existing giveaway before starting a new one.");
			return true;
		}

		const lockInfoText = this.config.userLock ? `Members are only eligible if they have chatted on at least ${this.config.userLock.days} day(s) and have at least ${this.config.userLock.talent} ${this.regularsPlugin.getScoreName()} when the giveaway ends.` : "";

		const giveawayMessage = await this.channel.send(`**A giveaway is starting for ${winnerCount} winner(s)!**\n${giveawayText.length ? `${giveawayText.join(" ")}\n` : ""}\n*To enter the giveaway, leave a reaction on this message. Reacting multiple times does not change your chances of winning. ${lockInfoText}*`) as Message;
		this.logger.info(`${message.member.displayName} started a giveaway for ${winnerCount} winner(s). Text: ${giveawayText}`);

		this.setData("giveaway", this.giveaway = {
			message: giveawayMessage.id,
			winnerCount
		});
		this.save();
		return true;
	}

	@Command("giveaway cancel")
	protected async commandCancelGiveaway (message: Message) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		if (!this.giveaway) {
			this.reply(message, "there is no giveaway running.");
			return true;
		}

		this.channel.send("The giveaway has been cancelled!");
		this.logger.info(`${message.member.displayName} cancelled the giveaway`);

		this.setData("giveaway", this.giveaway = undefined);
		this.save();
		return true;
	}

	@Command(["giveaway prize", "giveaway consolation"])
	protected async commandSetGiveawayConsolation (message: CommandMessage, prize?: string | number) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		if (!this.giveaway) {
			this.reply(message, "there is no giveaway running.");
			return true;
		}

		prize = +prize! || 0;

		const prizeType = message.command.endsWith("prize") ? "prize" : "consolation";
		this.giveaway[prizeType] = prize;
		this.save();

		if (prize)
			this.reply(message, `set the ${prizeType} ${this.regularsPlugin.getScoreName()} for the giveaway to ${prize}.`);
		else
			this.reply(message, `removed the ${prizeType} ${this.regularsPlugin.getScoreName()} for the giveaway.`);

		this.logger.info(`${message.member.displayName} set the giveaway ${prizeType} ${this.regularsPlugin.getScoreName()} to ${prize}`);
		return true;
	}

	@Command("giveaway end")
	protected async commandEndGiveaway (message: Message) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		if (!this.giveaway) {
			this.reply(message, "there is no giveaway running.");
			return true;
		}

		const winnerCount = this.giveaway.winnerCount;
		const prize = this.giveaway.prize;
		const consolation = this.giveaway.consolation;

		const announcementMessage = await this.getAnnouncementMessage(message, this.giveaway.message);
		if (!announcementMessage)
			return true;

		this.setData("giveaway", this.giveaway = undefined);
		this.save();

		return this.drawWinners(announcementMessage, winnerCount, prize || 0, consolation || 0);
	}

	@Command("giveaway info")
	protected async commandGiveawayInfo (message: Message, announcement?: string) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		if (announcement === this.giveaway?.message)
			announcement = undefined;

		if (!announcement && !this.giveaway) {
			this.reply(message, "there is no giveaway running.");
			return true;
		}

		const announcementMessage = await this.getAnnouncementMessage(message, announcement || this.giveaway!.message);
		if (!announcementMessage)
			return true;

		const entrants = (await this.getEntrants(announcementMessage))
			.filter(user => this.guild.members.has(user.id));

		this.sendAll(message.channel, `<@${message.member.id}>, here's some info on ${announcement ? "that" : "the **currently-running**"} giveaway:`,
			this.giveaway?.winnerCount && `Choosing **${this.giveaway.winnerCount} winners**`,
			this.giveaway?.prize && `Grand prize: **${this.giveaway.prize} ${this.regularsPlugin.getScoreName()}**`,
			this.giveaway?.consolation && `Consolation prize: **${this.giveaway.consolation} ${this.regularsPlugin.getScoreName()}**`,
			`All **${entrants.length}** entrants:`, ...entrants
				.map(user => `- ${this.regularsPlugin.getMemberName(user.id)}`));

		return true;
	}

	@Command("giveaway redraw")
	protected async commandRedrawGiveaway (message: Message, announcement: string, winnerCount: string | number, prize: string | number, consolation: string | number) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		const announcementMessage = await this.getAnnouncementMessage(message, announcement);
		if (!announcementMessage)
			return true;

		winnerCount = +winnerCount || 1;
		if (!Number.isInteger(winnerCount) || winnerCount <= 0) {
			this.reply(message, "winner count must be a positive integer.");
			return true;
		}

		return this.drawWinners(announcementMessage, winnerCount, +prize || 0, +consolation || 0);
	}

	private async getAnnouncementMessage (message: Message, announcement: string) {
		const announcementMessage = await this.channel.fetchMessage(announcement);
		if (announcementMessage)
			return announcementMessage;

		if (!announcement) {
			this.logger.warning("Giveaway announcement message inaccessible", this.giveaway);
			this.setData("giveaway", this.giveaway = undefined);
			this.save();
			this.reply(message, "there is no giveaway running.");
			return undefined;
		}

		this.reply(message, "must pass a valid announcement message ID. (Right click on the announcement message and hit Copy ID)");
		return undefined;
	}

	private async drawWinners (announcementMessage: Message, winnerCount: number, prize: number, consolation: number) {
		const entrants = await this.getEntrants(announcementMessage);

		const winners: GuildMember[] = [];
		do {
			const winnerIndex = Math.floor(Math.random() * entrants.length);
			for (const winner of entrants.splice(winnerIndex, 1)) {
				const member = await this.findMember(winner.id);
				if (!member) {
					this.logger.warning(`Chose winner ${winner.username}${winner.tag} that is no longer a guild member. Skipping...`);
					continue;
				}

				winners.push(member as GuildMember);
			}

		} while (winners.length < winnerCount && entrants.length > 0);

		const nonWinners: User[] = [];
		consolation = Math.floor(consolation);
		if (consolation)
			for (const entrant of entrants) {
				if (winners.some(winner => winner.id === entrant.id))
					// this entrant was a winner
					continue;

				const trackedMember = this.regularsPlugin.getTrackedMember(entrant.id);
				if (!trackedMember)
					// this member isn't tracked by the regulars plugin
					continue;

				nonWinners.push(entrant);
				trackedMember.talent += consolation;
				this.regularsPlugin.autoDonate(trackedMember);
			}

		const prizeText = !prize ? "" : `All ${winners.length} winner(s) received the grand prize of ${prize} ${this.regularsPlugin.getScoreName()}!`;
		const consolationText = !consolation ? "" : `Entered but didn't win? Don't worry! You still got a consolation prize of ${consolation} ${this.regularsPlugin.getScoreName()}!`;

		this.channel.send(`The giveaway has ended!\nWinners: ${winners.map(member => `<@${member.id}>`).join(", ")}\n\n${prizeText}\n\n${consolationText}`);
		this.logger.info(`The giveaway ended with the following winners: ${winners.map(member => member.displayName)}`);
		if (consolation)
			this.logger.info(`All other entrants given consolation prize of ${consolation} ${this.regularsPlugin.getScoreName()}: ${nonWinners.map(user => user.tag).join(", ")}`);

		return true;
	}

	private async getEntrants (message: Message) {
		let entrants = Array.from(await this.getReactors(message));

		if (this.config.userLock)
			entrants = entrants.filter(this.isEntrantQualified);

		return entrants;
	}

	@Bound
	private isEntrantQualified (entrant: User) {
		const trackedMember = this.regularsPlugin.getTrackedMember(entrant.id);

		if (trackedMember.talent < (this.config.userLock?.talent || 0))
			return false;

		if (trackedMember.daysVisited < (this.config.userLock?.days || 0))
			return false;

		return true;
	}
}
