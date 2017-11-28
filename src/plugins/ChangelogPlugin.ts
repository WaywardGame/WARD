import { Plugin } from "../Plugin";
import { sleep } from "../util/Async";
import discord from "../util/Discord";
import { seconds } from "../util/Time";
import { ChangeType, trello } from "../util/Trello";

const emotes: { [key: string]: string } = {
	[ChangeType.New]: "_new",
	[ChangeType.Improvement]: "_improvement",
	[ChangeType.Bug]: "_bug",
	[ChangeType.Balance]: "_balance",
	[ChangeType.Modding]: "_modding",
	[ChangeType.Mod]: "_mod",
	[ChangeType.Technical]: "_technical",
	[ChangeType.Regression]: "_regression"
};

export class ChangelogPlugin extends Plugin {
	private id = "changelog";
	private channel = "385039999168413697";
	public getId () {
		return this.id;
	}
	public setId (pid: string) {
		this.id = pid;
	}

	public async update () {
		console.log("Updating changelog...");
		const version = await trello.getNewestVersion();
		const changelog = await trello.getChangelog(version);

		const channel = discord.channels.find("id", this.channel);

		if (changelog.unsorted) {
			for (const card of changelog.unsorted) {
				let listedChanges = await this.getData("listedChanges") as string[];
				if (!listedChanges) {
					this.setData("listedChanges", listedChanges = []);
				}
				if (!listedChanges.includes(card.id)) {
					listedChanges.push(card.id);
					let change = "";
					for (const label of card.labels) {
						const emoji = this.getEmoji(label.name as ChangeType);
						if (emoji) {
							change += emoji;
						}
					}
					change += card.name;
					console.log(`Reporting new change: ${change}`);
					channel.send(change);
					await sleep(seconds(2));
				}
			}
		}
	}

	private getEmoji (emote: ChangeType) {
		if (!emotes[emote]) {
			return;
		}
		return discord.emojis.find("name", emotes[emote]);
	}
}
