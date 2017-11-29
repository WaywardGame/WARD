import { Guild, Message } from "discord.js";

import config from "./Config";
import { Plugin } from "./Plugin";
import { ChangelogPlugin } from "./plugins/ChangelogPlugin";
import { RegularsPlugin } from "./plugins/RegularsPlugin";
import { sleep } from "./util/Async";
import discord from "./util/Discord";

async function login () {
	const cfg = await config.get();
	await discord.login(cfg.discord.token);
}
async function logout () {
	await discord.destroy();
}

export class Ward {
	private guild: Guild;
	private commandPrefix: string;
	private plugins: { [key: string]: Plugin } = {};
	private stopped = true;
	private onStop: () => any;

	public async start () {
		if (this.stopped && !this.onStop) {
			this.stopped = false;

			const cfg = await config.get();
			this.commandPrefix = cfg.ward.commandPrefix;

			await login();
			this.guild = discord.guilds.find("id", cfg.discord.guild);

			discord.addListener("message", (message: Message) => {
				this.onMessage(message);
			});

			await this.startPlugins();

			while (!this.stopped) {
				await this.update();
				await sleep(100);
			}

			await this.stopPlugins();
			await this.savePlugins();

			await logout();

			this.onStop();
			delete this.onStop;
		}
	}

	public async stop () {
		if (!this.stopped) {
			this.stopped = true;

			return new Promise(resolve => {
				this.onStop = resolve;
			});
		}
	}

	public async update () {
		const promises: Array<Promise<any>> = [];

		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			if (plugin.onUpdate && Date.now() - plugin.lastUpdate > plugin.updateInterval) {
				promises.push(plugin.onUpdate());
				plugin.lastUpdate = Date.now();
			}
		}

		await Promise.all(promises);
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

	private onMessage (message: Message) {
		if (message.guild.id !== this.guild.id) {
			return;
		}

		if (message.content.startsWith(this.commandPrefix)) {
			this.onCommand(message);

		} else {
			for (const pluginName in this.plugins) {
				const plugin = this.plugins[pluginName];
				if (plugin.onMessage) {
					plugin.onMessage(message);
				}
			}
		}
	}

	private onCommand (message: Message) {
		const text = `${message.content.slice(this.commandPrefix.length)} `;
		const argsIndex = text.indexOf(" ");
		const command = text.slice(0, argsIndex);
		const args = text.slice(argsIndex).trim().split(" ");
		if (args[0] === "") {
			args.shift();
		}

		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			if (plugin.onCommand) {
				this.plugins[pluginName].onCommand(message, command, ...args);
			}
		}
	}

	private async startPlugins () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			if (plugin.onStart) {
				await this.plugins[pluginName].onStart(this.guild);
			}
		}
	}

	private async stopPlugins () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			if (plugin.onStop) {
				await this.plugins[pluginName].onStop();
			}
		}
	}

	private async savePlugins () {
		const promises: Array<Promise<any>> = [];
		for (const pid in this.plugins) {
			promises.push(this.plugins[pid].save());
		}

		await Promise.all(promises);
	}
}

const ward = new Ward();
ward.addPlugin(new ChangelogPlugin());
ward.addPlugin(new RegularsPlugin());
ward.start();

// So the program will not close instantly
process.stdin.resume();

async function exitHandler (err?: Error) {
	if (err) {
		// tslint:disable-next-line no-console
		console.log(err.stack);
	}

	await ward.stop();
	process.exit();
}

process.on("SIGINT", exitHandler);
process.on("SIGUSR1", exitHandler);
process.on("SIGUSR2", exitHandler);
process.on("uncaughtException", exitHandler);
