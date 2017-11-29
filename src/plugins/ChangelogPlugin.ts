import { Channel } from "discord.js";

import { Plugin } from "../Plugin";
import { sleep } from "../util/Async";
import discord from "../util/Discord";
import { hours, seconds } from "../util/Time";
import { ChangeType, IVersionInfo, trello } from "../util/Trello";

const skipLog = false;
const channel = "225111620290871296";
const internalRegressionDone = "5860937f318e0bde03f73dc0";
const generalDone = "571b0344f800eaf864b2c5e7";

const emotes: { [key: string]: string } = {
	[ChangeType.New]: "_new",
	[ChangeType.Improvement]: "_improvement",
	[ChangeType.Bug]: "_bug",
	[ChangeType.Balance]: "_balance",
	[ChangeType.Modding]: "_modding",
	[ChangeType.Mod]: "_mod",
	[ChangeType.Technical]: "_technical",
	[ChangeType.Internal]: "_internal",
	[ChangeType.Regression]: "_regression"
};

export class ChangelogPlugin extends Plugin {
	public updateInterval = hours(1);

	private id = "changelog";
	private channel: Channel;
	public getId () {
		return this.id;
	}
	public setId (pid: string) {
		this.id = pid;
	}

	public async update () {
		this.log("Updating changelog...");
		this.channel = discord.channels.find("id", channel);

		const version = await trello.getNewestVersion();
		await this.changelog(version);
		await this.changelog(internalRegressionDone);
		await this.changelog(generalDone);

		this.log("Update complete.");
	}

	private async changelog (version: IVersionInfo | string) {
		const changelog = await trello.getChangelog(version);
		const changes = changelog.unsorted;
		if (!changes) {
			return;
		}

		changes.sort((a, b) => new Date(a.dateLastActivity).getTime() - new Date(b.dateLastActivity).getTime());

		for (const card of changes) {
			let listedChanges = await this.getData("listedChanges") as string[];
			if (!listedChanges) {
				this.setData("listedChanges", listedChanges = []);
			}

			if (!listedChanges.includes(card.id)) {
				listedChanges.push(card.id);
				if (skipLog) {
					continue;
				}

				let change = "";
				for (const label of card.labels) {
					const emoji = this.getEmoji(label.name as ChangeType);
					if (emoji) {
						change += emoji;
					}
				}

				change += ` ${card.name} ${card.shortUrl}`;
				this.log(`Reporting new change: ${change}`);
				this.channel.send(change);

				await sleep(seconds(5));
			}
		}
	}

	private getEmoji (emote: ChangeType) {
		if (!emotes[emote]) {
			return undefined;
		}

		return discord.emojis.find("name", emotes[emote]);
	}
}
