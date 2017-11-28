"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Async_1 = require("./util/Async");
const ChangelogPlugin_1 = require("./plugins/ChangelogPlugin");
class Ward {
    constructor() {
        this.plugins = {};
        this.stopped = true;
    }
    async start() {
        if (this.stopped && !this.onStop) {
            this.stopped = false;
            while (!this.stopped) {
                this.update();
                await Async_1.sleep(100);
            }
            const promises = [];
            for (const pid in this.plugins) {
                promises.push(this.plugins[pid].save());
            }
            await Promise.all(promises);
            this.onStop();
            delete this.onStop;
        }
    }
    async stop() {
        if (!this.stopped) {
            this.stopped = true;
            return new Promise((resolve) => {
                this.onStop = resolve;
            });
        }
    }
    update() {
        for (const pluginName in this.plugins) {
            const plugin = this.plugins[pluginName];
            if (Date.now() - plugin.lastUpdate > plugin.updateInterval) {
                plugin.update();
                plugin.lastUpdate = Date.now();
            }
        }
    }
    addPlugin(plugin) {
        let pid = plugin.getId();
        let i = 0;
        while (pid in this.plugins) {
            pid = `${plugin.getId()}-${i++}`;
        }
        plugin.setId(pid);
        this.plugins[pid] = plugin;
        return pid;
    }
    removePlugin(pid) {
        delete this.plugins[pid];
    }
}
exports.Ward = Ward;
const ward = new Ward();
ward.addPlugin(new ChangelogPlugin_1.ChangelogPlugin());
ward.start();
process.stdin.resume();
async function exitHandler(err) {
    if (err) {
        console.log(err.stack);
    }
    await ward.stop();
    process.exit();
}
process.on("SIGINT", exitHandler);
process.on("SIGUSR1", exitHandler);
process.on("SIGUSR2", exitHandler);
process.on("uncaughtException", exitHandler);
