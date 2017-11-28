"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Plugin_1 = require("../Plugin");
const Trello_1 = require("../util/Trello");
var ChangeEmote;
(function (ChangeEmote) {
    ChangeEmote[ChangeEmote["New"] = 0] = "New";
    ChangeEmote[ChangeEmote["Improvement"] = 1] = "Improvement";
    ChangeEmote[ChangeEmote["Bug"] = 2] = "Bug";
    ChangeEmote[ChangeEmote["Balance"] = 3] = "Balance";
    ChangeEmote[ChangeEmote["Modding"] = 4] = "Modding";
    ChangeEmote[ChangeEmote["Mod"] = 5] = "Mod";
    ChangeEmote[ChangeEmote["Technical"] = 6] = "Technical";
    ChangeEmote[ChangeEmote["Regression"] = 7] = "Regression";
})(ChangeEmote || (ChangeEmote = {}));
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
class ChangelogPlugin extends Plugin_1.Plugin {
    constructor() {
        super(...arguments);
        this.id = "changelog";
    }
    getId() {
        return this.id;
    }
    setId(pid) {
        this.id = pid;
    }
    async update() {
        console.log("Updating changelog...");
        const version = await Trello_1.trello.getNewestVersion();
        const changelog = await Trello_1.trello.getChangelog(version);
        if (changelog.unsorted) {
            for (const card of changelog.unsorted) {
                let listedChanges = await this.getData("listedChanges");
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
exports.ChangelogPlugin = ChangelogPlugin;
