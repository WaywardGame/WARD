import { Plugin } from "./Plugin";
import { sleep } from "./util/Async";

import config from "./Config";
import { ChangelogPlugin } from "./plugins/ChangelogPlugin";
import discord from "./util/Discord";

export class Ward {
	private plugins: { [key: string]: Plugin } = {};
	private stopped = true;
	private onStop: () => any;

	public async start () {
		if (this.stopped && !this.onStop) {
			this.stopped = false;

			await config.get();

			while (!this.stopped) {
				this.update();
				await sleep(100);
			}

			await this.login();
			const promises: Array<Promise<any>> = [];
			for (const pid in this.plugins) {
				promises.push(this.plugins[pid].save());
			}
			await Promise.all(promises);
			await this.logout();

			this.onStop();
			delete this.onStop;
		}
	}

	public async login () {
		const cfg = await config.get();
		await discord.login(cfg.discord.token);
	}
	public async logout () {
		await discord.destroy();
	}

	public async stop () {
		if (!this.stopped) {
			this.stopped = true;
			return new Promise((resolve) => {
				this.onStop = resolve;
			});
		}
	}

	public update () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			if (Date.now() - plugin.lastUpdate > plugin.updateInterval) {
				plugin.update();
				plugin.lastUpdate = Date.now();
			}
		}
	}

	public addPlugin (plugin: Plugin) {
		let pid = plugin.getId();
		let i = 0;
		while (pid in this.plugins) {
			pid = `${plugin.getId()}-${i++}`;
		}
		plugin.setId(pid);
		this.plugins[pid] = plugin;
		return pid;
	}

	public removePlugin (pid: string) {
		delete this.plugins[pid];
	}
}

const ward = new Ward();
ward.addPlugin(new ChangelogPlugin());
ward.start();

// so the program will not close instantly
process.stdin.resume();

async function exitHandler (err?: Error) {
	if (err) {
		// tslint:disable-next-line no-console
		console.log(err.stack);
	}
	await ward.stop();
	process.exit();
}

// catches ctrl+c event
process.on("SIGINT", exitHandler);

// catches "kill pid" (for example: nodemon restart)
process.on("SIGUSR1", exitHandler);
process.on("SIGUSR2", exitHandler);

// catches uncaught exceptions
process.on("uncaughtException", exitHandler);
