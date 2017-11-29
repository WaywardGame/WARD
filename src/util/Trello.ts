import * as request from "request-promise-native";

import config from "../Config";
import { minutes } from "./Time";

export interface IVersionInfo {
	str: string;
	stage: "beta" | "release";
	major: number;
	minor: number;
	patch: number;
	name?: string;
	date?: Date;
}

const versionInfoRegExp = /^(beta|release)?(\d+)\.(\d+)(?:\.(\d+))?$/;
export function getVersionInfo (version: string): IVersionInfo {
	const versionInfo = version.match(versionInfoRegExp);
	if (!versionInfo) {
		throw new Error("Version string must be in the format '(beta|release)#.#(.#)?'");
	}

	return {
		str: version,
		stage: versionInfo[1] ? versionInfo[1] as "beta" | "release" : "beta",
		major: parseInt(versionInfo[2], 10),
		minor: parseInt(versionInfo[3], 10),
		patch: versionInfo[4] ? parseInt(versionInfo[4], 10) : 0
	};
}

export function isSameVersion (version: IVersionInfo, compareVersion: IVersionInfo) {
	return version.stage === compareVersion.stage
		&& version.major === compareVersion.major
		&& version.minor === compareVersion.minor
		&& version.patch === compareVersion.patch;
}

export interface ITrelloBoard {
	id: string;
	name: string;
	desc: string;
	lists?: ITrelloList[];
}

export interface ITrelloList {
	id: string;
	name: string;
	cards?: ITrelloCard[];
}

export interface ITrelloCard {
	id: string;
	name: string;
	pos: number;
	labels: ITrelloCardLabel[];
	important: boolean;
	dateLastActivity: string;
}

export interface ITrelloCardLabel {
	id: string;
	name: string;
	color: string;
}

export interface ITrelloChangelog {
	version: IVersionInfo;
	list: ITrelloList;
}

export interface IChangelog {
	version: IVersionInfo;
	sections: { [index: string]: ITrelloCard[] | undefined };
	unsorted?: ITrelloCard[];
	changeCount: number;
}

export enum ChangeType {
	New = "New",
	Improvement = "Improvement",
	Bug = "Bug",
	Balance = "Balance",
	Modding = "Modding",
	Mod = "Mod",
	Technical = "Technical",
	Internal = "Internal",
	Misc = "Misc",
	Regression = "Regression"
}

const changelogListRegExp = /^\s*(Beta|Release)\s+(\d+)\.(\d+)(?:\.(\d+))?(?:\s+"(.*?)")?(\s+\((January|February|March|April|May|June|July|August|September|October|November|December) (\d+(?:st|nd|rd|th)), (\d+)\))?\s*$/;

enum VersionInfoStage {
	beta,
	release
}

function sortVersionInfo (infoA: IVersionInfo, infoB: IVersionInfo, reverse = false): number {
	let result = VersionInfoStage[infoA.stage] - VersionInfoStage[infoB.stage];
	if (result === 0) {
		result = infoA.major - infoB.major;
		if (result === 0) {
			result = infoA.minor - infoB.minor;
			if (result === 0) {
				result = infoA.patch - infoB.patch;
			}
		}
	}

	return reverse ? -result : result;
}

const api = "https://api.trello.com/1";

export default class Trello {

	private versionCache: IVersionInfo[];
	private lastCachedVersions = 0;

	public async getChangelog (list: string): Promise<IChangelog | undefined>;
	public async getChangelog (versionInfo: IVersionInfo): Promise<IChangelog | undefined>;
	public async getChangelog (versionInfo: IVersionInfo | string): Promise<IChangelog | undefined>;
	public async getChangelog (versionInfo: IVersionInfo | string): Promise<IChangelog | undefined> {
		let changelog: ITrelloChangelog;
		if (typeof versionInfo === "string") {
			changelog = {
				version: undefined,
				list: await this.getCards(versionInfo)
			};

		} else {
			changelog = await this.findChangelogList(versionInfo);
			if (changelog) {
				changelog.list = await this.getCards(changelog.list);
			}
		}

		return changelog ? this.parseChangelog(changelog) : undefined;
	}

	public async getVersions (maxVersion?: IVersionInfo, board?: ITrelloBoard): Promise<IVersionInfo[]> {
		const result = [];
		if (!board) {
			if (Date.now() - this.lastCachedVersions < minutes(20)) {
				return this.versionCache;
			}

			const cfg = await config.get();

			// check both open and unopened lists on the default board
			board = await this.getBoard(cfg.trello.board);
			if (board) {
				result.push(...await this.getVersions(undefined, board));
				board = await this.getBoard(cfg.trello.board, true);
				result.push(...await this.getVersions(undefined, board));
			}

		} else {
			// check the lists of the board provided
			if (board.lists) {
				for (const list of board.lists) {
					const listVersionInfo = this.getListVersionInfo(list);
					if (!listVersionInfo) {
						continue;
					}

					result.push(listVersionInfo);
				}
			}
		}

		result.sort((infoA, infoB) => sortVersionInfo(infoA, infoB, true));
		if (maxVersion) {
			// remove versions past the maximum version
			while (sortVersionInfo(result[0], maxVersion) > 0) {
				result.shift();
			}
		}

		this.versionCache = result;
		this.lastCachedVersions = Date.now();

		return result;
	}

	public async getNewestVersion () {
		const versions = await this.getVersions();
		return versions[0];
	}

	private async getCards (list: ITrelloList | string): Promise<ITrelloList> {
		return this.trelloRequest(`/lists/${typeof list === "string" ? list : list.id}?cards=open&fields=name&card_fields=name,labels,pos,dateLastActivity`);
	}

	private async getBoard (boardId: string, checkClosed: boolean = false): Promise<ITrelloBoard> {
		return this.trelloRequest(`/boards/${boardId}?lists=${checkClosed ? "closed" : "open"}&list_fields=name&fields=name,desc`);
	}

	private async trelloRequest (rq: string) {
		const cfg = await config.get();
		return request(`${api}${rq}&key=${cfg.trello.key}`, {
			json: true
		});
	}

	private getListVersionInfo (list: ITrelloList): IVersionInfo | undefined {
		const match = list.name.match(changelogListRegExp);
		if (!match) {
			// is not a valid version list
			return undefined;
		}

		const listVersionInfo: IVersionInfo = {
			str: "",
			stage: match[1].toLowerCase() as "beta" | "release",
			major: parseInt(match[2], 10),
			minor: parseInt(match[3], 10),
			patch: match[4] ? parseInt(match[4], 10) : 0
		};

		listVersionInfo.str = `${listVersionInfo.stage}${listVersionInfo.major}.${listVersionInfo.minor}.${listVersionInfo.patch}`;

		if (match[5]) {
			listVersionInfo.name = match[5];
		}

		if (match[6]) {
			listVersionInfo.date = new Date(`${match[7]} ${parseInt(match[8], 10)}, ${match[9]}`);
		}

		return listVersionInfo;
	}

	private async findChangelogList (versionInfo: IVersionInfo, board?: ITrelloBoard): Promise<ITrelloChangelog | undefined> {
		if (!board) {

			const cfg = await config.get();

			// check both open and unopened lists on the default board
			board = await this.getBoard(cfg.trello.board);
			if (board) {
				let result = await this.findChangelogList(versionInfo, board);
				if (result) {
					return result;
				}

				board = await this.getBoard(cfg.trello.board, true);
				result = await this.findChangelogList(versionInfo, board);

				if (result) {
					return result;
				}
			}

		} else {
			// check the lists of the board provided
			if (board.lists) {
				for (const list of board.lists) {
					const listVersionInfo = this.getListVersionInfo(list);
					if (!listVersionInfo) {
						continue;
					}

					// check if the list changelog is the same version as the changelog list we're searching for
					if (isSameVersion(listVersionInfo, versionInfo)) {
						return {
							version: listVersionInfo,
							list: await this.getCards(list) // update cards
						};
					}
				}
			}
		}

		return undefined;
	}

	private parseChangelog (changelogData: ITrelloChangelog): IChangelog {
		const changelog: IChangelog = {
			version: changelogData.version,
			sections: {},
			unsorted: changelogData.list.cards,
			changeCount: 0
		};
		const list = changelogData.list;
		if (list.cards) {
			changelog.changeCount = list.cards.length;

			for (const card of list.cards) {
				const labels = card.labels;

				let sectionId: ChangeType | undefined;

				if (labels.some((v) => v.name === ChangeType.New)) {
					sectionId = ChangeType.New;

				} else if (labels.some((v) => v.name === ChangeType.Mod)) {
					sectionId = ChangeType.Mod;

				} else if (labels.some((v) => v.name === ChangeType.Modding)) {
					sectionId = ChangeType.Modding;

				} else if (labels.some((v) => v.name === ChangeType.Improvement)) {
					sectionId = ChangeType.Improvement;

				} else if (labels.some((v) => v.name === ChangeType.Bug)) {
					sectionId = ChangeType.Bug;

				} else if (labels.some((v) => v.name === ChangeType.Balance)) {
					sectionId = ChangeType.Balance;

				} else if (labels.some((v) => v.name === ChangeType.Technical)) {
					sectionId = ChangeType.Technical;

				} else if (labels.some((v) => v.name === ChangeType.Internal)) {
					sectionId = ChangeType.Internal;

				}

				if (sectionId === undefined) {
					// tslint:disable-next-line no-console
					console.log(`[Trello] Missing section id for ${card.name}`, card);
					continue;
				}

				card.important = labels.some((v) => v.name === "Important");

				let section = changelog.sections[sectionId];
				if (!section) {
					section = changelog.sections[sectionId] = [];
				}

				section.push(card);
			}
		}

		const sectionKeys = Object.keys(ChangeType);
		for (let i = 0; i < sectionKeys.length / 2; i++) {
			const section = changelog.sections[i];
			if (section) {
				changelog.sections[i] = section.sort((a: ITrelloCard, b: ITrelloCard) => b.pos - a.pos);
			}
		}

		return changelog;
	}

}

export const trello = new Trello();
