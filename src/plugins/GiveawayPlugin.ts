import { GuildMember, Message, RichEmbed, TextChannel, User } from "discord.js";
import { Command, ImportPlugin } from "../core/Api";
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
	consolation?: number;
}

export class GiveawayPlugin extends Plugin<IGiveawayPluginConfig, IGiveawayData> {
	private channel: TextChannel;
	private giveaway?: IGiveawayInfo;

	@ImportPlugin("regulars")
	private regularsPlugin: RegularsPlugin = undefined!;

	public getDefaultId () {
		return "giveaway";
	}

	public async onStart () {
		this.channel = this.guild.channels.find(channel => channel.id === this.config.channel) as TextChannel;
		this.giveaway = this.getData("giveaway", undefined);
	}

	@Command(["help giveaway", "giveaway help"])
	protected async commandGiveawayHelp (message: Message) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		// TODO, add support later: You can use a decimal number between 0 and 1 to set a fraction of entrants to win. (The minimum number of users that will win is 1.)
		this.reply(message, new RichEmbed().setDescription(`
\`!giveaway <winnerCount=1> <text?>\`
Starts a new giveaway. The giveaway will persist until it is ended or cancelled. Users can enter the giveaway by reacting to the announcement message.

\u200b \u200b \u200b \u200b ◇ \`winnerCount\` — The number of entrants that should win the giveaway. Must be a positive integer.

\u200b \u200b \u200b \u200b ◇ \`text\` — Text that will be printed as part of the giveaway announcement message. **Note:** By default, the message does not ping any users. If you'd like users to be pinged, include an \`@everyone\` in this, and send the giveaway command via DMs so it doesn't ping anyone.


\`!giveaway end\`
Ends the giveaway, pinging all of the winners in an announcement message.


\`!giveaway cancel\`
Cancels the current giveaway. The announcement message will *not* be deleted automatically.


\`!giveaway redraw <announcementMessageId> <winnerCount=1> <consolation${this.regularsPlugin.getScoreName()}?>\`
Redraws winners for the giveaway announced with the given message.

\u200b \u200b \u200b \u200b ◇ \`announcementMessageId\` — The ID of the message used to announce the giveaway. (The one that people add reactions to.) You can get the ID by right clicking the message and choosing "Copy ID".

\u200b \u200b \u200b \u200b ◇ \`winnerCount\` — The number of entrants that should win the giveaway. Must be a positive integer.

\u200b \u200b \u200b \u200b ◇ \`consolation${this.regularsPlugin.getScoreName()}\` — _Optional_. The consolation prize to give anyone that doesn't win.


\`!giveaway entrants <announcementMessageId?>\`
Lists the current entrants for the currently-running giveaway.

\u200b \u200b \u200b \u200b ◇ \`announcementMessageId\` — _Optional_. The announcement message of the giveaway to return the entrants of. If not provided, lists the entrants of the currently running giveaway.


\`!giveaway consolation <consolation${this.regularsPlugin.getScoreName()}?>\`
Sets the consolation prize for anyone that doesn't win the currently-running giveaway.

\u200b \u200b \u200b \u200b ◇ \`consolation${this.regularsPlugin.getScoreName()}\` — _Optional_. The consolation prize to give anyone that doesn't win. If not provided, removes the consolation prize.
`));
		return true;
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

	@Command("giveaway consolation")
	protected async commandSetGiveawayConsolation (message: Message, consolation?: string | number) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		if (!this.giveaway) {
			this.reply(message, "there is no giveaway running.");
			return true;
		}

		consolation = +consolation! || 0;

		this.giveaway.consolation = consolation;
		this.save();

		if (consolation)
			this.reply(message, `set the consolation ${this.regularsPlugin.getScoreName()} for the giveaway to ${consolation}.`);
		else
			this.reply(message, `removed the consolation ${this.regularsPlugin.getScoreName()} for the giveaway.`);

		this.logger.info(`${message.member.displayName} set the giveaway consolation ${this.regularsPlugin.getScoreName()} to ${consolation}`);
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
		const consolation = this.giveaway.consolation;
		const announcementMessage = await this.channel.fetchMessage(this.giveaway.message);

		this.setData("giveaway", this.giveaway = undefined);
		this.save();

		return this.drawWinners(announcementMessage, winnerCount, consolation || 0);
	}

	@Command("giveaway entrants")
	protected async commandGiveawayEntrants (message: Message, announcement: string) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		if (!announcement && !this.giveaway) {
			this.reply(message, "there is no giveaway running.");
			return true;
		}

		const announcementMessage = await this.channel.fetchMessage(announcement || this.giveaway!.message);
		const entrants = await this.getEntrants(announcementMessage);

		this.sendAll(this.channel, `<@${message.member.id}>, All **${entrants.length}** entrants:`, ...entrants
			.map(user => this.regularsPlugin.getMemberName(user.id)));

		return true;
	}

	@Command("giveaway redraw")
	protected async commandRedrawGiveaway (message: Message, announcement: string, winnerCount: string | number, consolation: string | number) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		const announcementMessage = await this.channel.fetchMessage(announcement);
		if (!announcementMessage) {
			this.reply(message, "must pass a valid announcement message ID. (Right click on the announcement message and hit Copy ID)");
			return true;
		}

		winnerCount = +winnerCount || 1;
		if (!Number.isInteger(winnerCount) || winnerCount <= 0) {
			this.reply(message, "winner count must be a positive integer.");
			return true;
		}

		return this.drawWinners(announcementMessage, winnerCount, +consolation || 0);
	}

	private async drawWinners (announcementMessage: Message, winnerCount: number, consolation: number) {
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

		const consolationText = !consolation ? "" : `Didn't win? You got a consolation prize of ${consolation} ${this.regularsPlugin.getScoreName()}!`;

		this.channel.send(`The giveaway has ended! Winners: ${winners.map(member => `<@${member.id}>`).join(", ")}\n\n${consolationText}`);
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
