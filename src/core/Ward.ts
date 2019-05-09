import { Client, Guild, Message } from "discord.js";
import { ChangelogPlugin } from "../plugins/ChangelogPlugin";
import { ColorsPlugin } from "../plugins/ColorPlugin";
import { GiveawayPlugin } from "../plugins/GiveawayPlugin";
import { RegularsPlugin } from "../plugins/RegularsPlugin";
import { RoleTogglePlugin } from "../plugins/RoleTogglePlugin";
import { SpamPlugin } from "../plugins/SpamPlugin";
import { TwitchStreamPlugin } from "../plugins/TwitchStreamPlugin";
import { sleep } from "../util/Async";
import { Trello } from "../util/Trello";
import { Twitch } from "../util/Twitch";
import { Api, metadataKeyImportApi, metadataKeyImportPlugin } from "./Api";
import { IConfig } from "./Config";
import { Importable } from "./Importable";
import { Plugin, IPluginConfig } from "./Plugin";
import ExternalPlugin, { ExternalPluginEntryPoint } from "./ExternalPlugin";
import { Logger } from "../util/Log";


export class Ward {
	private config: IConfig;
	private guild: Guild;
	private discord: Client;
	private commandPrefix: string;
	private plugins: { [key: string]: Plugin } = {};
	private apis: { [key: string]: Api } = {};
	private stopped = true;
	private onStop: () => any;

	constructor (cfg: IConfig) {
		this.config = cfg;
		this.addApi(new Trello());
		this.addApi(new Twitch());
		this.addPlugin(new ChangelogPlugin());
		this.addPlugin(new RegularsPlugin());
		this.addPlugin(new RoleTogglePlugin());
		this.addPlugin(new TwitchStreamPlugin());
		this.addPlugin(new GiveawayPlugin());
		this.addPlugin(new SpamPlugin());
		this.addPlugin(new ColorsPlugin());

		if (cfg.externalPlugins) {
			for (const pluginCfg of cfg.externalPlugins) {
				const externalPluginEntryPointModule = require(pluginCfg.classFile);
				const externalPluginEntryPoint: ExternalPluginEntryPoint = externalPluginEntryPointModule.default;
				const externalPlugin = externalPluginEntryPoint && externalPluginEntryPoint.initialize &&
					externalPluginEntryPoint.initialize(ExternalPlugin);
				if (externalPlugin) this.addPlugin(externalPlugin, pluginCfg);
				else Logger.log("External Plugins", `Unable to load plugin ${pluginCfg.classFile}`);
			}
		}
	}

	public async start () {
		if (this.stopped && !this.onStop) {
			this.stopped = false;

			this.commandPrefix = this.config.commandPrefix;

			await this.login();
			this.guild = this.discord.guilds.find(guild => guild.id === this.config.apis.discord.guild);

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
			if (this.config.plugins[pluginName] === false) continue;

			const plugin = this.plugins[pluginName];
			if (plugin.onUpdate && Date.now() - plugin.lastUpdate > plugin.updateInterval) {
				promises.push(plugin.onUpdate());
				plugin.lastUpdate = Date.now();
			}

			if (Date.now() - plugin.lastAutosave > plugin.autosaveInterval) {
				promises.push(plugin.save());
				plugin.lastAutosave = Date.now();
			}
		}

		await Promise.all(promises);
	}

	public addPlugin (plugin: Plugin, config?: false | IPluginConfig) {
		const id = this.addImportable(plugin, this.plugins);
		config = config || this.config.plugins[id];
		if (config) {
			plugin.config = config;
		}

		return id;
	}

	public removePlugin (pid: string) {
		delete this.plugins[pid];
	}

	public addApi (api: Api) {
		const id = this.addImportable(api, this.apis);
		const config = this.config.apis[id];
		if (config) {
			api.config = config;
		}

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
			message.member = this.guild.members.find(member => member.id === message.author.id);
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
			if (this.config.plugins[pluginName] === false) continue;

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
			const config = this.config.plugins[pluginName];
			if (config === false) continue;

			plugin.config = config;
			if (plugin.onStart) {
				await this.plugins[pluginName].onStart();
			}
		}
	}

	private async pluginHookStop () {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName];
			if (plugin.onStop) {
				await this.plugins[pluginName].onStop();
			}
		}
	}

	private pluginHookInit () {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName];
			plugin.user = this.discord.user;
			plugin.guild = this.guild;
			for (const property in plugin) {
				// import apis
				let metadata = Reflect.getMetadata(metadataKeyImportApi, plugin, property);
				if (metadata) {
					(plugin as any)[property] = this.getApi(metadata);
				}

				// import other plugins
				metadata = Reflect.getMetadata(metadataKeyImportPlugin, plugin, property);
				if (metadata) {
					(plugin as any)[property] = this.plugins[metadata];
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
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			promises.push(this.plugins[pluginName].save());
		}

		await Promise.all(promises);
	}

	private pluginHookMessage (message: Message) {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName];
			if (plugin.onMessage) {
				plugin.onMessage(message);
			}
		}
	}

	private isDisabledPlugin (id: string) {
		const plugin = this.plugins[id];
		return !(plugin instanceof ExternalPlugin) && this.config.plugins[id] === false;
	}
}
