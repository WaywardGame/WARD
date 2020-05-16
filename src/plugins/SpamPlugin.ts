
import { Message } from "discord.js";
import { Plugin } from "../core/Plugin";
import { sleep } from "../util/Async";
import { getTime, TimeUnit } from "../util/Time";

const discordURLRegex = /\bdiscord\.gg\/[A-Za-z0-9]{4,}\b/;

export interface ISpamPluginConfig {
	banIfLeaveWithin?: string | [TimeUnit, number] | false;
}

export class SpamPlugin extends Plugin<ISpamPluginConfig> {
	public getDefaultId () {
		return "spam";
	}

	public async onMessage (message: Message) {
		if (message.type !== "GUILD_MEMBER_JOIN")
			return;

		if (discordURLRegex.test(message.author.username)) {
			message.delete();
			this.guild.ban(message.author, { reason: "Bad username" });
			this.logger.warning(`Banned user ${message.author.username}. Reason: Bad username.`);
			return;
		}

		if (this.config.banIfLeaveWithin === false)
			return;

		await sleep(getTime(this.config.banIfLeaveWithin) || 5000);

		await this.guild.fetchMembers();

		if (!this.guild.members.get(message.author.id)) {
			message.delete();
			this.guild.ban(message.author, { reason: "Suspicious activity" });
			this.logger.warning(`Banned user ${message.author.username}. Reason: Suspicious activity.`);
		}
	}

	public getDefaultConfig () {
		return {
			banIfLeaveWithin: "5 seconds",
		};
	}

}
