
import { Plugin } from "../core/Plugin";
import { Message } from "discord.js";

const discordURLRegex = /^discord\.gg\/[A-Za-z0-9]{4,}$/;

export class SpamPlugin extends Plugin<{}> {
	public getDefaultId () {
		return "spam";
	}

	public async onMessage (message: Message) {
		if (message.type === "GUILD_MEMBER_JOIN") {
			if (discordURLRegex.test(message.author.username)) {
				message.delete();
				this.guild.ban(message.author);
				this.log(`Banned user ${message.author.username}. Reason: Bad username.`);
			}
		}
	}

}
