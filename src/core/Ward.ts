import { Client, Guild, Message } from "discord.js";

import { ChangelogPlugin } from "../plugins/ChangelogPlugin";
import { RegularsPlugin } from "../plugins/RegularsPlugin";
import { RoleTogglePlugin } from "../plugins/RoleTogglePlugin";
import { TwitchStreamPlugin } from "../plugins/TwitchStreamPlugin";
import { sleep } from "../util/Async";
import { Trello } from "../util/Trello";
import { Twitch } from "../util/Twitch";
import { Api, metadataKeyImport } from "./Api";
import { IConfig } from "./Config";
import { Importable } from "./Importable";
import { Plugin } from "./Plugin";

export class Ward {
	private config: IConfig;
	private guild: Guild;
	private discord: Client;
	private commandPrefix: string;
	private plugins: { [key: string]: Plugin } = {};
	private apis: { [key: string]: Api } = {};
	private stopped = true;
	private onStop: () => any;

	constructor(cfg: IConfig) {
		this.config = cfg;
		this.addApi(new Trello());
		this.addApi(new Twitch());
		this.addPlugin(new ChangelogPlugin());
		this.addPlugin(new RegularsPlugin());
		this.addPlugin(new RoleTogglePlugin());
		this.addPlugin(new TwitchStreamPlugin());
	}

	public async start () {
		if (this.stopped && !this.onStop) {
			this.stopped = false;

			this.commandPrefix = this.config.commandPrefix;

			await this.login();
			this.guild = this.discord.guilds.find("id", this.config.apis.discord.guild);

			this.pluginHookInit();

			this.discord.addListener("message", m => this.onMessage(m));

			await this.pluginHookStart();

			while (!this.stopped) {
				await this.update();
				await sleep(100);
			}

			await this.pluginHookStop();
			await this.pluginHookSave();

			await this.logout();

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
		const id = this.addImportable(plugin, this.plugins);
		plugin.config = this.config.plugins[id];

		return id;
	}

	public removePlugin (pid: string) {
		delete this.plugins[pid];
	}

	public addApi (api: Api) {
		const id = this.addImportable(api, this.apis);
		api.config = this.config.apis[id];

		return id;
	}

	private addImportable (importable: Importable, obj: { [key: string]: Importable }) {
		let id = importable.getId();
		let i = 0;
		while (id in obj) {
			id = `${importable.getId()}-${i++}`;
		}

		importable.setId(id);
		obj[id] = importable;

		return id;
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

	private async login () {
		this.discord = new Client();
		await this.discord.login(this.config.apis.discord.token);
	}
	private async logout () {
		await this.discord.destroy();
		delete this.discord;
	}

	private async pluginHookStart () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			plugin.config = this.config.plugins[pluginName];
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

	private pluginHookInit () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			plugin.user = this.discord.user;
			plugin.guild = this.guild;
			for (const property in plugin) {
				const metadata = Reflect.getMetadata(metadataKeyImport, plugin, property);
				if (metadata) {
					(plugin as any)[property] = this.getApi(metadata);
				}
			}
		}
	}

	private getApi (name: string) {
		for (const apiName in this.apis) {
			if (apiName.startsWith(name) && !isNaN(+apiName.slice(name.length))) {
				return this.apis[apiName];
			}
		}

		return undefined;
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
