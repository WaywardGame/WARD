import { Channel } from "discord.js";

import { Plugin } from "../Plugin";
import { sleep } from "../util/Async";
import discord from "../util/Discord";
import { hours, seconds } from "../util/Time";
import { ChangeType, ITrelloCard, IVersionInfo, trello } from "../util/Trello";

/**
 * Set this variable to true and allow the plugin to update once to save that the bot has reported all possible changes.
 * This is useful when the api changes.
 */
const skipLog = false;

const emotes: { [key: string]: string } = {
	[ChangeType.New]: "_new",
	[ChangeType.Improvement]: "_improvement",
	[ChangeType.Bug]: "_bug",
	[ChangeType.Balance]: "_balance",
	[ChangeType.Modding]: "_modding",
	[ChangeType.Mod]: "_mod",
	[ChangeType.Technical]: "_technical",
	[ChangeType.Internal]: "_internal",
	[ChangeType.Regression]: "_regression",
};

const changeOrder = [
	ChangeType.New,
	ChangeType.Improvement,
	ChangeType.Bug,
	ChangeType.Balance,
	ChangeType.Modding,
	ChangeType.Mod,
	ChangeType.Technical,
	ChangeType.Internal,
	ChangeType.Regression,
];

export enum ChangelogData {
	ReportedChanges,
}

export interface IChangelogConfig {
	reportingChannel: string;
	reportedLists?: string[];
}

export class ChangelogPlugin extends Plugin<ChangelogData, IChangelogConfig> {
	public updateInterval = hours(1);

	private channel: Channel;
	private isReporting = false;
	private reportedChanges: string[];

	public getDefaultId () {
		return "changelog";
	}

	public async onStart () {
		this.reportedChanges = await this.data(ChangelogData.ReportedChanges, []) as string[];
	}

	public async onUpdate () {
		if (this.isReporting) {
			return;
		}

		this.log("Updating changelog...");
		this.channel = discord.channels.find("id", this.config.reportingChannel);

		const version = await trello.getNewestVersion();
		this.isReporting = true;
		await this.changelog(version);
		if (this.config.reportedLists) {
			for (const list of this.config.reportedLists) {
				await this.changelog(list);
			}
		}

		this.isReporting = false;
		this.log("Update complete.");
		this.save();
	}

	private async changelog (version: IVersionInfo | string) {
		const changelog = await trello.getChangelog(version);
		const changes = changelog.unsorted;
		if (!changes) {
			return;
		}

		changes.sort((a, b) => new Date(a.dateLastActivity).getTime() - new Date(b.dateLastActivity).getTime());

		for (const card of changes) {
			await this.reportChange(card);
		}
	}

	private async reportChange (card: ITrelloCard) {

		if (!this.reportedChanges.includes(card.id)) {
			this.reportedChanges.push(card.id);
			if (skipLog) {
				return;
			}

			let change = this.generateChangeTypeEmojiPrefix(card);

			change += ` ${card.name} ${card.shortUrl}`;
			this.log(`Reporting new change: ${change}`);
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

		return discord.emojis.find("name", emotes[emote]);
	}
}
