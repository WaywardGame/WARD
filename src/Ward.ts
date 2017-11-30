import { Guild, Message } from "discord.js";

import config, { IConfig } from "./Config";
import { Plugin } from "./Plugin";
import { ChangelogPlugin } from "./plugins/ChangelogPlugin";
import { RegularsPlugin } from "./plugins/RegularsPlugin";
import { RoleTogglePlugin } from "./plugins/RoleTogglePlugin";
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
	private config: IConfig;
	private guild: Guild;
	private commandPrefix: string;
	private plugins: { [key: string]: Plugin } = {};
	private stopped = true;
	private onStop: () => any;

	constructor(cfg: IConfig) {
		this.config = cfg;
		this.addPlugin(new ChangelogPlugin());
		this.addPlugin(new RegularsPlugin());
		this.addPlugin(new RoleTogglePlugin());
	}

	public async start () {
		if (this.stopped && !this.onStop) {
			this.stopped = false;

			this.commandPrefix = this.config.ward.commandPrefix;

			await login();
			this.guild = discord.guilds.find("id", this.config.discord.guild);

			this.pluginHookSetGuild();

			discord.addListener("message", (message: Message) => {
				this.onMessage(message);
			});

			await this.pluginHookStart();

			while (!this.stopped) {
				await this.update();
				await sleep(100);
			}

			await this.pluginHookStop();
			await this.pluginHookSave();

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
		plugin.config = this.config.ward.plugins[pid];
		this.plugins[pid] = plugin;

		return pid;
	}

	public removePlugin (pid: string) {
		delete this.plugins[pid];
	}

	private onMessage (message: Message) {
		if (message.author.bot) {
			return;
		}

		if (!message.member) {
			message.member = this.guild.members.find("id", message.author.id);
		}

		if (!message.member) {
			return;
		}

		if (message.content.startsWith(this.commandPrefix)) {
			this.onCommand(message);

		} else {
			this.pluginHookMessage(message);
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

	private async pluginHookStart () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			plugin.config = this.config.ward.plugins[pluginName];
			if (plugin.onStart) {
				await this.plugins[pluginName].onStart();
			}
		}
	}

	private async pluginHookStop () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			if (plugin.onStop) {
				await this.plugins[pluginName].onStop();
			}
		}
	}

	private pluginHookSetGuild () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			plugin.guild = this.guild;
		}
	}

	private async pluginHookSave () {
		const promises: Array<Promise<any>> = [];
		for (const pid in this.plugins) {
			promises.push(this.plugins[pid].save());
		}

		await Promise.all(promises);
	}

	private pluginHookMessage (message: Message) {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			if (plugin.onMessage) {
				plugin.onMessage(message);
			}
		}
	}
}

let ward: Ward;
config.get().then(cfg => {
	ward = new Ward(cfg);
	ward.start();
});

// So the program will not close instantly
process.stdin.resume();

async function exitHandler (err?: Error) {
	if (err) {
		// tslint:disable-next-line no-console
		console.log(err.stack);
	}

	await Promise.race([
		ward.stop(),
		sleep(2000),
	]);
	process.exit();
}

process.on("SIGINT", exitHandler);
process.on("SIGUSR1", exitHandler);
process.on("SIGUSR2", exitHandler);
process.on("uncaughtException", exitHandler);
process.on("unhandledRejection", exitHandler);
