import { GuildMember, Message, Role, TextChannel } from "discord.js";
import { Command, ImportPlugin } from "../core/Api";
import { Plugin } from "../core/Plugin";
import { RegularsPlugin } from "./RegularsPlugin";


export type IGiveawayPluginConfig = {
	channel: string;
	userLock?: {
		talent: number;
		days: number;
	};
}

export interface IGiveawayData {
	giveaway: IGiveawayInfo;
}

interface IGiveawayInfo {
	winnerCount: number;
	message: string;
}

export class GiveawayPlugin extends Plugin<IGiveawayPluginConfig, IGiveawayData> {
	private channel: TextChannel;
	private roleDev: Role;
	private giveaway: IGiveawayInfo;

	@ImportPlugin("regulars")
	private regularsPlugin: RegularsPlugin = undefined;

	public getDefaultId () {
		return "giveaway";
	}

	public async onStart () {
		this.roleDev = this.guild.roles.find(role => role.name === "wayward-dev");
		this.channel = this.guild.channels.find(channel => channel.id === this.config.channel) as TextChannel;
		this.giveaway = this.getData("giveaway", undefined);
	}

	@Command("giveaway")
	public commandGiveaway (message: Message, winnerCountOrEnd: string, giveawayText?: string) {
		if (winnerCountOrEnd === "end") {
			return this.commandEndGiveaway(message);
		} else {
			return this.commandStartGiveaway(message, +winnerCountOrEnd, giveawayText);
		}
	}

	// tslint:disable cyclomatic-complexity
	private async commandStartGiveaway (message: Message, winnerCount = 1, giveawayText?: string) {
		if (!message.member.roles.has(this.roleDev.id)) {
			this.reply(message, "only devs may start a giveaway.");
			return;
		}

		if (winnerCount <= 0) {
			this.reply(message, "invalid winner count, must be an integer greater than 0.");
			return;
		}

		if (this.giveaway) {
			this.reply(message, "there is already a giveaway, please finish or cancel the existing giveaway before starting a new one.");
			return;
		}

		const lockInfoText = this.config.userLock ? `Members are only eligible if they have chatted on at least ${this.config.userLock.days} day(s) and have at least ${this.config.userLock.talent} talent when the giveaway ends.` : "";

		const giveawayMessage = await this.channel.send(`@everyone **A giveaway is starting for ${winnerCount} winner(s)!** ${giveawayText}\n\n*To enter, leave a reaction on this message. Reacting multiple times does not change your chances of winning. ${lockInfoText}*`) as Message;

		this.setData("giveaway", this.giveaway = {
			message: giveawayMessage.id,
			winnerCount
		});
		this.save();
	}

	private async commandEndGiveaway (message: Message) {
		if (!message.member.roles.has(this.roleDev.id)) {
			this.reply(message, "only devs may end a giveaway.");
			return;
		}

		if (!this.giveaway) {
			this.reply(message, "there is no giveaway running.");
			return;
		}

		const giveawayMessage = await this.channel.fetchMessage(this.giveaway.message);
		const winnerCount = this.giveaway.winnerCount;

		this.setData("giveaway", this.giveaway = undefined);
		this.save();

		const users: string[] = [];
		for (const reaction of giveawayMessage.reactions.values()) {
			for (const [id] of await reaction.fetchUsers()) {
				if (!users.includes(id)) {
					users.push(id);
				}
			}
		}

		if (this.config.userLock) users.filter(user => {
			const trackedMember = this.regularsPlugin.getTrackedMember(user);

			if (trackedMember.talent < this.config.userLock.talent) return false;
			if (trackedMember.daysVisited < this.config.userLock.days) return false;

			return true;
		});

		if (users.length < winnerCount) {
			this.reply(message, "there were no winners, as there were not enough eligible entrants.");
			return;
		}

		const winners: GuildMember[] = [];
		do {
			const winnerIndex = Math.floor(Math.random() * users.length);
			for (const winner of users.splice(winnerIndex, 1)) {
				winners.push(await this.findMember(winner) as GuildMember);
			}
		} while (winners.length < winnerCount);

		this.channel.send(`The giveaway has ended! Winners: ${winners.map(user => `<@${user.id}>`).join(", ")}`);
	}
}
