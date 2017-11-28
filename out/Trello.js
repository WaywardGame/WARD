"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const request = require("request-promise-native");
const Time_1 = require("./util/Time");
const versionInfoRegExp = /^(beta|release)?(\d+)\.(\d+)(?:\.(\d+))?$/;
function getVersionInfo(version) {
    const versionInfo = version.match(versionInfoRegExp);
    if (!versionInfo) {
        throw new Error("Version string must be in the format '(beta|release)#.#(.#)?'");
    }
    return {
        str: version,
        stage: versionInfo[1] ? versionInfo[1] : "beta",
        major: parseInt(versionInfo[2], 10),
        minor: parseInt(versionInfo[3], 10),
        patch: versionInfo[4] ? parseInt(versionInfo[4], 10) : 0
    };
}
exports.getVersionInfo = getVersionInfo;
function isSameVersion(version, compareVersion) {
    return version.stage === compareVersion.stage
        && version.major === compareVersion.major
        && version.minor === compareVersion.minor
        && version.patch === compareVersion.patch;
}
exports.isSameVersion = isSameVersion;
var ChangelogSection;
(function (ChangelogSection) {
    ChangelogSection[ChangelogSection["New"] = 0] = "New";
    ChangelogSection[ChangelogSection["Improvements"] = 1] = "Improvements";
    ChangelogSection[ChangelogSection["BugFixes"] = 2] = "BugFixes";
    ChangelogSection[ChangelogSection["Balance"] = 3] = "Balance";
    ChangelogSection[ChangelogSection["Modding"] = 4] = "Modding";
    ChangelogSection[ChangelogSection["Mod"] = 5] = "Mod";
    ChangelogSection[ChangelogSection["Technical"] = 6] = "Technical";
    ChangelogSection[ChangelogSection["Misc"] = 7] = "Misc";
})(ChangelogSection = exports.ChangelogSection || (exports.ChangelogSection = {}));
const changelogListRegExp = /^\s*(Beta|Release)\s+(\d+)\.(\d+)(?:\.(\d+))?(?:\s+"(.*?)")?(\s+\((January|February|March|April|May|June|July|August|September|October|November|December) (\d+(?:st|nd|rd|th)), (\d+)\))?\s*$/;
var VersionInfoStage;
(function (VersionInfoStage) {
    VersionInfoStage[VersionInfoStage["beta"] = 0] = "beta";
    VersionInfoStage[VersionInfoStage["release"] = 1] = "release";
})(VersionInfoStage || (VersionInfoStage = {}));
function sortVersionInfo(infoA, infoB, reverse = false) {
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
const waywardBoard = "PWX1Hpjn";
const key = "&key=d7df9259b89ab10b1676d7b841a4f9df";
class Trello {
    constructor() {
        this.lastCachedVersions = 0;
    }
    getChangelog(versionInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            const changelog = yield this.findChangelogList(versionInfo);
            if (changelog) {
                changelog.list = yield this.getCards(changelog.list);
                return this.parseChangelog(changelog);
            }
            return undefined;
        });
    }
    getVersions(maxVersion, board) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = [];
            if (!board) {
                if (Date.now() - this.lastCachedVersions < Time_1.minutes(20)) {
                    return this.versionCache;
                }
                board = yield this.getBoard(waywardBoard);
                if (board) {
                    result.push(...yield this.getVersions(undefined, board));
                    board = yield this.getBoard(waywardBoard, true);
                    result.push(...yield this.getVersions(undefined, board));
                }
            }
            else {
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
                while (sortVersionInfo(result[0], maxVersion) > 0) {
                    result.shift();
                }
            }
            this.versionCache = result;
            this.lastCachedVersions = Date.now();
            return result;
        });
    }
    getNewestVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            const versions = yield this.getVersions();
            return versions[0];
        });
    }
    getCards(list) {
        return __awaiter(this, void 0, void 0, function* () {
            return request(`${api}/lists/${list.id}?cards=open&fields=name&card_fields=name,labels,pos${key}`, {
                json: true
            });
        });
    }
    getBoard(boardId, checkClosed = false) {
        return __awaiter(this, void 0, void 0, function* () {
            return request(`${api}/boards/${boardId}?lists=${checkClosed ? "closed" : "open"}&list_fields=name&fields=name,desc${key}`, {
                json: true
            });
        });
    }
    getListVersionInfo(list) {
        const match = list.name.match(changelogListRegExp);
        if (!match) {
            return undefined;
        }
        const listVersionInfo = {
            str: "",
            stage: match[1].toLowerCase(),
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
    findChangelogList(versionInfo, board) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!board) {
                board = yield this.getBoard(waywardBoard);
                if (board) {
                    let result = yield this.findChangelogList(versionInfo, board);
                    if (result) {
                        return result;
                    }
                    board = yield this.getBoard(waywardBoard, true);
                    result = yield this.findChangelogList(versionInfo, board);
                    if (result) {
                        return result;
                    }
                }
            }
            else {
                if (board.lists) {
                    for (const list of board.lists) {
                        const listVersionInfo = this.getListVersionInfo(list);
                        if (!listVersionInfo) {
                            continue;
                        }
                        if (isSameVersion(listVersionInfo, versionInfo)) {
                            return {
                                version: listVersionInfo,
                                list: yield this.getCards(list)
                            };
                        }
                    }
                }
            }
            return undefined;
        });
    }
    parseChangelog(changelogData) {
        const changelog = {
            version: changelogData.version,
            sections: {},
            changeCount: 0
        };
        const list = changelogData.list;
        if (list.cards) {
            changelog.changeCount = list.cards.length;
            for (const card of list.cards) {
                const labels = card.labels;
                let sectionId;
                if (labels.some((v) => v.name === "New")) {
                    sectionId = ChangelogSection.New;
                }
                else if (labels.some((v) => v.name === "Mod")) {
                    sectionId = ChangelogSection.Mod;
                }
                else if (labels.some((v) => v.name === "Modding")) {
                    sectionId = ChangelogSection.Modding;
                }
                else if (labels.some((v) => v.name === "Improvement")) {
                    sectionId = ChangelogSection.Improvements;
                }
                else if (labels.some((v) => v.name === "Bug")) {
                    sectionId = ChangelogSection.BugFixes;
                }
                else if (labels.some((v) => v.name === "Balance")) {
                    sectionId = ChangelogSection.Balance;
                }
                else if (labels.some((v) => v.name === "Technical")) {
                    sectionId = ChangelogSection.Technical;
                }
                if (sectionId === undefined) {
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
        const sectionKeys = Object.keys(ChangelogSection);
        for (let i = 0; i < sectionKeys.length / 2; i++) {
            const section = changelog.sections[i];
            if (section) {
                changelog.sections[i] = section.sort((a, b) => b.pos - a.pos);
            }
        }
        return changelog;
    }
}
exports.default = Trello;
exports.trello = new Trello();
