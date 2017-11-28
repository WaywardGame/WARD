"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("mz/fs");
class Config {
    constructor() {
        this.onGetHandlers = [];
        this.isGetting = false;
    }
    async get() {
        if (this.result) {
            return this.result;
        }
        else {
            if (!this.isGetting) {
                this.isGetting = true;
                fs.readFile("config.json", "utf8").then((text) => {
                    const result = JSON.parse(text);
                    this.result = result;
                    for (const onGetHandler of this.onGetHandlers) {
                        onGetHandler(this.result);
                    }
                    delete this.onGetHandlers;
                    this.isGetting = false;
                }).catch((err) => {
                    console.log("Can't load config file");
                });
            }
            return new Promise((resolve) => {
                this.onGetHandlers.push(resolve);
            });
        }
    }
}
exports.Config = Config;
const config = new Config();
exports.default = config;
