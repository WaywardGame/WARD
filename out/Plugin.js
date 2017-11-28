"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("mz/fs");
const Time_1 = require("./util/Time");
class Plugin {
    constructor() {
        this.updateInterval = Time_1.minutes(5);
        this.lastUpdate = 0;
        this.data = {};
        this.loaded = false;
    }
    async save() {
        await fs.mkdir("data").catch((err) => { });
        await fs.writeFile(this.getDataPath(), JSON.stringify(this.data));
    }
    async setData(key, data) {
        this.data[key] = data;
    }
    async getData(key) {
        if (!this.loaded) {
            this.loaded = true;
            if (await fs.exists(this.getDataPath())) {
                this.data = JSON.parse(await fs.readFile(this.getDataPath(), "utf8"));
            }
        }
        return this.data[key];
    }
    getDataPath() {
        return `data/${this.getId()}.json`;
    }
}
exports.Plugin = Plugin;
