export interface IVersionInfo {
    str: string;
    stage: "beta" | "release";
    major: number;
    minor: number;
    patch: number;
    name?: string;
    date?: Date;
}
export declare function getVersionInfo(version: string): IVersionInfo;
export declare function isSameVersion(version: IVersionInfo, compareVersion: IVersionInfo): boolean;
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
    sections: {
        [index: number]: ITrelloCard[] | undefined;
    };
    unsorted?: ITrelloCard[];
    changeCount: number;
}
export declare enum ChangelogSection {
    New = 0,
    Improvements = 1,
    BugFixes = 2,
    Balance = 3,
    Modding = 4,
    Mod = 5,
    Technical = 6,
    Misc = 7,
}
export default class Trello {
    private versionCache;
    private lastCachedVersions;
    getChangelog(versionInfo: IVersionInfo): Promise<IChangelog | undefined>;
    getVersions(maxVersion?: IVersionInfo, board?: ITrelloBoard): Promise<IVersionInfo[]>;
    getNewestVersion(): Promise<IVersionInfo>;
    private getCards(list);
    private getBoard(boardId, checkClosed?);
    private trelloRequest(rq);
    private getListVersionInfo(list);
    private findChangelogList(versionInfo, board?);
    private parseChangelog(changelogData);
}
export declare const trello: Trello;
