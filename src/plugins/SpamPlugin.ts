
import { Plugin } from "../core/Plugin";
import { Message } from "discord.js";
import { sleep } from "../util/Async";

const discordURLRegex = /^discord\.gg\/[A-Za-z0-9]{4,}$/;

export class SpamPlugin extends Plugin<{}> {
	public getDefaultId () {
		return "spam";
	}

	public async onMessage (message: Message) {
		if (message.type === "GUILD_MEMBER_JOIN") {
			if (discordURLRegex.test(message.author.username)) {
				message.delete();
				this.guild.ban(message.author, { reason: "Bad username" });
				this.log(`Banned user ${message.author.username}. Reason: Bad username.`);

			} else if ((await sleep(5000)) || !this.guild.members.get(message.author.id)) {
				message.delete();
				this.guild.ban(message.author, { reason: "Suspicious activity" });
				this.log(`Banned user ${message.author.username}. Reason: Suspicious activity.`);
			}
		}
	}

}
