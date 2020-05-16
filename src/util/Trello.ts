import * as request from "request-promise-native";
import { Api } from "../core/Api";
import Logger from "./Log";
import { minutes } from "./Time";


const endpoint = "https://api.trello.com/1";

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
		patch: versionInfo[4] ? parseInt(versionInfo[4], 10) : 0,
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
	shortUrl: string;
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
	Regression = "Regression",
	Refactor = "Refactor",
}

// tslint:disable-next-line max-line-length
const changelogListRegExp = /^\s*(Beta|Release)\s+(\d+)\.(\d+)(?:\.(\d+))?(?:\s+"(.*?)")?(\s+\((January|February|March|April|May|June|July|August|September|October|November|December) (\d+(?:st|nd|rd|th)), (\d+)\))?\s*$/;

enum VersionInfoStage {
	beta,
	release,
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

export interface ITrelloConfig {
	board: string;
	key: string;
}

export class Trello extends Api<ITrelloConfig> {

	private versionCache: IVersionInfo[];
	private lastCachedVersions = 0;

	public getDefaultId () {
		return "trello";
	}

	public async getChangelog (versionInfo: IVersionInfo | string): Promise<IChangelog | undefined> {
		let changelog: ITrelloChangelog;
		if (typeof versionInfo === "string") {
			changelog = {
				version: undefined,
				list: await this.getCards(versionInfo),
			};

		} else {
			changelog = await this.findChangelogList(versionInfo);
			if (changelog) {
				changelog.list = await this.getCards(changelog.list);
			}
		}

		return changelog ? this.parseChangelog(changelog) : undefined;
	}

	public async getVersions (maxVersion?: IVersionInfo): Promise<IVersionInfo[]> {
		const result = [];
		if (Date.now() - this.lastCachedVersions < minutes(20)) {
			return this.versionCache;
		}

		// Check both open and unopened lists on the default board
		let board = await this.getBoard(this.config.board);
		if (board) {
			result.push(...this.getCardsFromBoard(board));
			board = await this.getBoard(this.config.board, true);
			result.push(...this.getCardsFromBoard(board));
		}

		result.sort((infoA, infoB) => sortVersionInfo(infoA, infoB, true));
		if (maxVersion) {
			// Remove versions past the maximum version
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

	private getCardsFromBoard (board: ITrelloBoard) {
		const result = [];

		if (board.lists) {
			for (const list of board.lists) {
				const listVersionInfo = this.getListVersionInfo(list);
				if (!listVersionInfo) {
					continue;
				}

				result.push(listVersionInfo);
			}
		}

		return result;
	}

	private async getCards (list: ITrelloList | string): Promise<ITrelloList> {
		list = typeof list === "string" ? list : list.id;

		return this.trelloRequest(
			`/lists/${list}?cards=open&fields=name&card_fields=name,labels,pos,dateLastActivity,shortUrl`,
		);
	}

	private async getBoard (boardId: string, checkClosed: boolean = false): Promise<ITrelloBoard> {
		const closed = checkClosed ? "closed" : "open";

		return this.trelloRequest(`/boards/${boardId}?lists=${closed}&list_fields=name&fields=name,desc`);
	}

	private async trelloRequest (rq: string) {
		return request(`${endpoint}${rq}&key=${this.config.key}`, {
			json: true,
		});
	}

	private getListVersionInfo (list: ITrelloList): IVersionInfo | undefined {
		const match = list.name.match(changelogListRegExp);
		if (!match) {
			// Not a valid version list
			return undefined;
		}

		const listVersionInfo: IVersionInfo = {
			str: "",
			stage: match[1].toLowerCase() as "beta" | "release",
			major: parseInt(match[2], 10),
			minor: parseInt(match[3], 10),
			patch: match[4] ? parseInt(match[4], 10) : 0,
		};

		listVersionInfo.str =
			`${listVersionInfo.stage}${listVersionInfo.major}.${listVersionInfo.minor}.${listVersionInfo.patch}`;

		if (match[5]) {
			listVersionInfo.name = match[5];
		}

		if (match[6]) {
			listVersionInfo.date = new Date(`${match[7]} ${parseInt(match[8], 10)}, ${match[9]}`);
		}

		return listVersionInfo;
	}

	private async findChangelogList (versionInfo: IVersionInfo): Promise<ITrelloChangelog | undefined> {
		let result: ITrelloChangelog | undefined;
		// Check both open and unopened lists on the default board
		await this.forBoard(this.config.board, async board => {
			if (board.lists) {
				for (const list of board.lists) {
					const listVersionInfo = this.getListVersionInfo(list);
					if (!listVersionInfo) {
						continue;
					}

					// Check if the list changelog is the same version as the changelog list we're searching for
					if (isSameVersion(listVersionInfo, versionInfo)) {
						result = {
							version: listVersionInfo,
							list: await this.getCards(list), // Update cards
						};

						return false;
					}
				}
			}
		});

		return result;
	}

	private async forBoard (boardId: string, cb: (board: ITrelloBoard) => Promise<boolean | undefined>) {
		let board = await this.getBoard(boardId);
		if (board) {
			let result = await cb(board);
			if (result === false) {
				return true;
			}

			board = await this.getBoard(boardId, true);
			result = await cb(board);
			if (result === false) {
				return true;
			}
		}

		return false;
	}

	private parseChangelog (changelogData: ITrelloChangelog): IChangelog {
		let changelog: IChangelog;
		const list = changelogData.list;
		if (list.cards) {
			changelog = {
				version: changelogData.version,
				...this.parseCards(list.cards),
			} as IChangelog;
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

	private parseCards (cards: ITrelloCard[]) {
		const changelog: Partial<IChangelog> = {
			sections: {},
			unsorted: cards,
			changeCount: cards.length,
		};

		for (const card of cards) {
			const sectionId = this.getChangeType(card);

			if (sectionId === undefined) {
				// tslint:disable-next-line no-console
				Logger.warning("trello", `Missing section id for ${card.name}`, card);
				continue;
			}

			card.important = card.labels.some(v => v.name === "Important");

			let section = changelog.sections[sectionId];
			if (!section) {
				section = changelog.sections[sectionId] = [];
			}

			section.push(card);
		}

		return changelog;
	}

	private getChangeType (card: ITrelloCard) {
		let changeType: ChangeType | undefined;

		for (const label of card.labels) {
			if (label.name in ChangeType) {
				changeType = label.name as ChangeType;
			}
		}

		return changeType;
	}
}
