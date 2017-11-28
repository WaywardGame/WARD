import { Plugin } from "../Plugin";
import { trello } from "../util/Trello";

enum ChangeEmote {
	New,
	Improvement,
	Bug,
	Balance,
	Modding,
	Mod,
	Technical,
	Regression
}
const emotes = {
	[ChangeEmote.New]: "changenew",
	[ChangeEmote.Improvement]: "changeimprovement",
	[ChangeEmote.Bug]: "changebug",
	[ChangeEmote.Balance]: "changebalance",
	[ChangeEmote.Modding]: "changemodding",
	[ChangeEmote.Mod]: "changemod",
	[ChangeEmote.Technical]: "changetechnical",
	[ChangeEmote.Regression]: "changeregression"
};

export class ChangelogPlugin extends Plugin {
	private id = "changelog";
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

		if (changelog.unsorted) {
			for (const card of changelog.unsorted) {
				let listedChanges = await this.getData("listedChanges") as string[];
				if (!listedChanges) {
					this.setData("listedChanges", listedChanges = []);
				}
				if (!listedChanges.includes(card.id)) {
					listedChanges.push(card.id);
					console.log(`Reporting new change: ${card.name}`);
				}
			}
		}
	}
}
