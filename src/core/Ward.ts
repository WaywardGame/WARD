import chalk from "chalk";
import { Client, Guild, Message } from "discord.js";
import AutoRolePlugin from "../plugins/AutoRoleApplyPlugin";
import { ChangelogPlugin } from "../plugins/ChangelogPlugin";
import { ColorsPlugin } from "../plugins/ColorPlugin";
import { GiveawayPlugin } from "../plugins/GiveawayPlugin";
import { RegularsPlugin } from "../plugins/RegularsPlugin";
import { RoleTogglePlugin } from "../plugins/RoleTogglePlugin";
import { SpamPlugin } from "../plugins/SpamPlugin";
import { TwitchStreamPlugin } from "../plugins/TwitchStreamPlugin";
import WelcomePlugin from "../plugins/WelcomePlugin";
import { sleep } from "../util/Async";
import Data from "../util/Data";
import Logger from "../util/Log";
import { Trello } from "../util/Trello";
import { Twitch } from "../util/Twitch";
import { Api, CommandFunction, CommandMetadata, SYMBOL_COMMAND, SYMBOL_IMPORT_API_KEY, SYMBOL_IMPORT_PLUGIN_KEY } from "./Api";
import { IConfig, IGuildConfig } from "./Config";
import ExternalPlugin, { ExternalPluginEntryPoint } from "./ExternalPlugin";
import { Importable } from "./Importable";
import { IPluginConfig, Plugin } from "./Plugin";

type Command = { function?: CommandFunction, subcommands: CommandMap };
type CommandMap = Map<string, Command>;

export class Ward {
	private guild: Guild;
	private discord: Client;
	private commandPrefix: string;
	private plugins: { [key: string]: Plugin } = {};
	private apis: { [key: string]: Api } = {};
	private stopped = true;
	private onStop: () => any;
	private readonly commands: CommandMap = new Map();
	private readonly anythingCommands = new Set<CommandFunction>();
	private readonly logger = new Logger(this.config.apis.discord.guild);

	public constructor (private readonly config: IConfig & IGuildConfig) {
		this.addApi(new Trello());
		this.addApi(new Twitch());
		this.addApi(new Data(this.config.apis.discord.guild));
		this.addPlugin(new ChangelogPlugin());
		this.addPlugin(new WelcomePlugin());
		this.addPlugin(new AutoRolePlugin());
		this.addPlugin(new RegularsPlugin());
		this.addPlugin(new RoleTogglePlugin());
		this.addPlugin(new TwitchStreamPlugin());
		this.addPlugin(new GiveawayPlugin());
		this.addPlugin(new SpamPlugin());
		this.addPlugin(new ColorsPlugin());

		if (this.config.externalPlugins) {
			for (const pluginCfg of this.config.externalPlugins) {
				const externalPluginEntryPointModule = require(pluginCfg.classFile);
				const externalPluginEntryPoint: ExternalPluginEntryPoint = externalPluginEntryPointModule.default;
				const externalPlugin = externalPluginEntryPoint && externalPluginEntryPoint.initialize &&
					externalPluginEntryPoint.initialize(ExternalPlugin);
				if (externalPlugin) this.addPlugin(externalPlugin, pluginCfg);
				else Logger.error("External Plugins", `Unable to load plugin ${pluginCfg.classFile}`);
			}
		}
	}

	public async start () {
		if (!this.stopped || (this as any).onStop)
			return;

		this.stopped = false;

		this.commandPrefix = this.config.commandPrefix;

		this.logger.verbose("Login");
		await this.login();
		this.guild = this.discord.guilds.find(guild => guild.id === this.config.apis.discord.guild);
		this.logger.popScope();
		this.logger.pushScope(this.guild.name);

		this.logger.verbose("Data init & backup");
		await this.getApi<Data>("data")?.init();

		this.logger.verbose("Plugins init");
		this.pluginHookInit();

		this.discord.addListener("message", m => this.onMessage(m));
		// this.discord.addListener("guildMemberUpdate", member => this.onMemberUpdate(member));

		this.logger.verbose("Plugins start");
		await this.pluginHookStart();

		this.logger.verbose("Entering main process");
		while (!this.stopped) {
			await this.update();
			await sleep(100);
		}

		this.logger.verbose("Plugins stop");
		await this.pluginHookStop();

		this.logger.verbose("Plugins final save");
		await this.pluginHookSave();

		this.logger.verbose("Logout");
		await this.logout();

		this.logger.verbose("Stop");
		this.onStop();
		delete this.onStop;
	}

	public async stop () {
		if (!this.stopped) {
			this.logger.verbose(`"Stopped bot for guild: '${this.guild?.name}'`)
			this.stopped = true;

			return new Promise(resolve => this.onStop = resolve);
		}
	}

	public async update () {
		const promises: Array<Promise<any>> = [];

		for (const pluginName in this.plugins) {
			if (this.config.plugins[pluginName] === false)
				continue;

			// this.logger.verbose("Loop plugin", pluginName);

			const plugin = this.plugins[pluginName];
			if (plugin.onUpdate && Date.now() - plugin.lastUpdate > plugin.updateInterval) {
				this.updatePlugin(plugin);
			}

			// if (!Object.keys(plugin["pluginData"]).length)
			// 	console.log("could not save", pluginName, this.guild.name);
			if (plugin.isDirty || Date.now() - plugin.lastAutosave > plugin.autosaveInterval) {
				this.logger.verbose("Save plugin", pluginName);
				plugin.lastAutosave = Date.now();
				promises.push(plugin.save());
			}
		}

		await Promise.all(promises);
	}

	private async updatePlugin (plugin: Plugin) {
		this.logger.verbose("Update plugin", plugin.getId());
		plugin.lastUpdate = Date.now();
		await plugin.onUpdate?.();
		plugin.lastUpdate = Date.now();
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
		const args = message.content.slice(this.commandPrefix.length)
			.trim()
			.replace(/\n/g, " \n")
			.replace(/[ \t]+/g, " ")
			.split(" ")
			.filter(v => v);

		let commandMap: CommandMap | undefined = this.commands;
		let command: Command | undefined;
		while (true) {
			const word = args[0];
			if (!commandMap?.has(word))
				break;

			args.shift();

			command = commandMap.get(word);
			commandMap = command?.subcommands;
		}

		if (command)
			command.function?.(message, ...args);

		else
			for (const command of this.anythingCommands)
				command(message, ...args);
	}

	private async login () {
		this.discord = new Client();
		this.discord.on("error", console.error);
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

			if (config === false)
				continue;

			plugin.config = config ?? plugin.config ?? plugin.getDefaultConfig();

			// initial load of plugin data
			if (!plugin["loaded"]) {
				plugin["loaded"] = true;
				this.logger.verbose("Load data for plugin", pluginName);
				plugin["pluginData"] = await this.getApi<Data>("data")?.load(plugin)
					.catch(err => this.logger.warning(`Unable to load ${pluginName} data`, err))
					?? {};

				if (plugin["pluginData"]._lastUpdate)
					plugin.lastUpdate = plugin["pluginData"]._lastUpdate;
			}

			if (plugin.onStart)
				await this.plugins[pluginName].onStart?.();
		}
	}

	private async pluginHookStop () {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName];
			if (plugin.onStop)
				await this.plugins[pluginName].onStop?.();
		}
	}

	private pluginHookInit () {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName] as Plugin;
			plugin.user = this.discord.user;
			plugin.guild = this.guild;
			plugin.logger = new Logger(this.guild.name, plugin.getId());

			for (const property in plugin) {
				// import apis
				let metadata = Reflect.getMetadata(SYMBOL_IMPORT_API_KEY, plugin, property);
				if (metadata) {
					(plugin as any)[property] = this.getApi(metadata);
				}

				// import other plugins
				metadata = Reflect.getMetadata(SYMBOL_IMPORT_PLUGIN_KEY, plugin, property);
				if (metadata) {
					(plugin as any)[property] = this.plugins[metadata];
				}
			}
		}

		this.registerCommand(["plugin", "update"], (message: Message, plugin: string) => this.commandUpdatePlugin(message, plugin));

		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName] as any;
			for (const property of Object.getOwnPropertyNames(plugin.constructor.prototype)) {
				let [commands, condition]: CommandMetadata = Reflect.getMetadata(SYMBOL_COMMAND, plugin, property) || [];
				if (typeof commands === "function")
					commands = commands(plugin);

				for (const command of Array.isArray(commands) ? commands : [commands]) {
					if (command && (!condition || condition(plugin))) {
						const alreadyExisted = this.registerCommand(command.split(" "), plugin[property].bind(plugin));
						const logText = `command '${chalk.cyan(`!${command}`)}' for plugin '${chalk.grey(pluginName)}'`;
						if (alreadyExisted)
							this.logger.warning(`Re-registered ${logText}`);
						else
							this.logger.verbose(`Registered ${logText}`);
					}
				}
			}
		}
	}

	private commandUpdatePlugin (message: Message, pluginName: string) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		const plugin = this.plugins[pluginName];
		if (!plugin) {
			message.reply(`can't update plugin ${pluginName}, not found.`);
			return false;
		}

		this.logger.info(`Updating plugin "${pluginName}" due to request from ${message.member.displayName}`);
		this.updatePlugin(plugin);
		message.reply(`updated plugin ${pluginName}.`);
		return true;
	}

	private registerCommand (words: string[], commandFunction: CommandFunction, commandMap = this.commands) {
		if (words.length === 1 && words[0] === "*") {
			this.anythingCommands.add(commandFunction);
			return;
		}

		while (true) {
			const word = words.shift();
			const command = commandMap.getOrDefault(word!, () => ({ subcommands: new Map() }), true);

			if (!words.length) {
				const alreadyExisted = !!command.function;
				command.function = commandFunction;
				return alreadyExisted;
			}

			commandMap = command.subcommands;
		}
	}

	private getApi<A extends Api = Api> (name: string): A | undefined {
		for (const apiName in this.apis) {
			if (apiName.startsWith(name) && !isNaN(+apiName.slice(name.length))) {
				return this.apis[apiName] as A;
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

	// private async catastrophicCrash (...args: any[]) {
	// 	this.log(...args);
	// 	await this.logout();
	// 	await this.stop();
	// 	while (true)
	// 		await sleep(99999999);
	// }
}
