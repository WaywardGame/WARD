import Stream from "@wayward/goodstream";
import chalk from "chalk";
import { Client, Guild, GuildMember, Message, MessageReaction, PartialMessage, User } from "discord.js";
import { EventEmitter } from "events";
import AutoRolePlugin from "../plugins/AutoRoleApplyPlugin";
import { ChangelogPlugin } from "../plugins/ChangelogPlugin";
import { ColorsPlugin } from "../plugins/ColorPlugin";
import { CrossPostPlugin } from "../plugins/CrossPostPlugin";
import { GiveawayPlugin } from "../plugins/GiveawayPlugin";
import KingPlugin from "../plugins/KingPlugin";
import PronounsPlugin from "../plugins/PronounsPlugin";
import { RegularsPlugin } from "../plugins/RegularsPlugin";
import { RemindersPlugin } from "../plugins/ReminderPlugin";
import { RoleTogglePlugin } from "../plugins/RoleTogglePlugin";
import { SpamPlugin } from "../plugins/SpamPlugin";
import StoryPlugin from "../plugins/StoryPlugin";
import { TwitchStreamPlugin } from "../plugins/TwitchStreamPlugin";
import WelcomePlugin from "../plugins/WelcomePlugin";
import WishPlugin from "../plugins/WishPlugin";
import { tuple } from "../util/Arrays";
import { sleep } from "../util/Async";
import Bound from "../util/Bound";
import Data from "../util/Data";
import Logger from "../util/Log";
import { seconds } from "../util/Time";
import { Trello } from "../util/Trello";
import { Twitch } from "../util/Twitch";
import { Api, CommandFunction, CommandMessage, CommandMetadata, CommandResult, SYMBOL_COMMAND, SYMBOL_IMPORT_API_KEY, SYMBOL_IMPORT_PLUGINS_KEY, SYMBOL_IMPORT_PLUGIN_KEY } from "./Api";
import { IConfig, IGuildConfig } from "./Config";
import ExternalPlugin, { ExternalPluginEntryPoint } from "./ExternalPlugin";
import { Importable } from "./Importable";
import { Paginator } from "./Paginatable";
import { IPluginConfig, Plugin } from "./Plugin";

type Command = { function?: CommandFunction, plugin?: string, subcommands: CommandMap };
type CommandMap = Map<string, Command>;

export class Ward {

	public readonly event = new EventEmitter();

	private guild: Guild;
	private discord?: Client;
	private commandPrefix: string;
	private plugins: { [key: string]: Plugin } = {};
	private apis: { [key: string]: Api } = {};
	private stopped = true;
	private onStop?: () => any;
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
		this.addPlugin(new StoryPlugin());
		this.addPlugin(new RemindersPlugin());
		this.addPlugin(new WishPlugin());
		this.addPlugin(new KingPlugin());
		this.addPlugin(new PronounsPlugin());
		this.addPlugin(new CrossPostPlugin());

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
		this.guild = await this.discord!.guilds.fetch(this.config.apis.discord.guild, true, true);
		this.logger.popScope();
		this.logger.pushScope(this.guild.name);

		this.logger.verbose("Data init & backup");
		await this.getApi<Data>("data")?.init();

		this.logger.verbose("Plugins init");
		this.pluginHookInit();

		this.logger.verbose("Plugins start");
		await this.pluginHookStart();

		this.discord!.addListener("message", m => this.onMessage(m));
		this.discord!.addListener("messageUpdate", (o, n) => this.onEdit(o, n));
		this.discord!.addListener("messageDelete", m => this.onDelete(m));
		this.discord!.addListener("messageReactionAdd", (r, u) => this.onReaction(r, u));
		// this.discord.addListener("guildMemberUpdate", member => this.onMemberUpdate(member));

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
		this.onStop?.();
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
			const plugin = this.plugins[pluginName];
			const config = this.config.plugins[pluginName];
			if (!plugin.shouldExist(config))
				continue;

			// this.logger.verbose("Loop plugin", pluginName);

			if (plugin.onUpdate && Date.now() - plugin.lastUpdate > plugin.updateInterval)
				promises.push(this.updatePlugin(plugin)
					.then(plugin.data.saveOpportunity));
		}

		await Promise.all(promises);
	}

	private async updatePlugin (plugin: Plugin) {
		plugin.logger.verbose("Update");
		plugin.lastUpdate = Date.now();
		await plugin.onUpdate?.();
		plugin.lastUpdate = Date.now();
	}

	public addPlugin (plugin: Plugin, config?: false | IPluginConfig) {
		const id = this.addImportable(plugin, this.plugins);
		config = config || this.config.plugins[id];
		if (config)
			plugin.config = config;

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
		if (message.author.bot)
			return;

		if (message.channel.isAwaitingMessages(message))
			return;

		if (!message.member)
			Object.defineProperty(message, "member", { value: this.guild.members.cache.get(message.author.id) });;

		if (!message.member)
			return;

		if (message.content.startsWith(this.commandPrefix))
			this.onCommand(message);

		else
			this.pluginHookMessage(message);
	}

	private onEdit (oldMessage: Message, message: Message) {
		if (message.author.bot)
			return;

		if (!oldMessage.member)
			Object.defineProperty(oldMessage, "member", { value: this.guild.members.cache.get(message.author.id) });

		if (!message.member)
			Object.defineProperty(message, "member", { value: this.guild.members.cache.get(message.author.id) });

		if (!message.member)
			return;

		this.pluginHookEdit(oldMessage, message);
	}

	private onReaction (reaction: MessageReaction, user: User) {
		if (user.bot)
			return;

		const member = this.guild.members.cache.get(user.id);
		if (!member)
			return;

		this.pluginHookReaction(reaction, member);
	}

	private onDelete (message: Message) {
		if (message.author.bot)
			return;

		if (!message.member)
			Object.defineProperty(message, "member", { value: this.guild.members.cache.get(message.author.id) });;

		if (!message.member)
			return;

		this.pluginHookDelete(message);
	}

	private onCommand (message: Message) {
		if (!message.content.startsWith(this.commandPrefix))
			return;

		const args = message.content.slice(this.commandPrefix.length)
			.trim()
			.replace(/\n/g, " \n")
			.replace(/[ \t]+/g, " ")
			.split(" ")
			.filter(v => v);

		const commandMessage = message as CommandMessage;
		let commandName = "";

		let commandMap: CommandMap | undefined = this.commands;
		let command: Command | undefined;
		while (true) {
			const word = args[0];
			if (!commandMap?.has(word))
				break;

			args.shift();

			commandName += `${word} `;
			command = commandMap.get(word);
			commandMap = command?.subcommands;
		}

		commandMessage.command = commandName.trimEnd();
		commandMessage.args = args;

		if (command) {
			Promise.resolve(command.function?.(commandMessage, ...args))
				.then(async result => {
					await this.plugins[command?.plugin!]?.data.saveOpportunity();

					if (result?.type !== "fail")
						return;

					// result === false means the user might've made a mistake, let's keep listening for a while to see if they edit
					const handleMessageEdit = async (old1: Message | PartialMessage, new1: Message | PartialMessage) => {
						if (old1.id === commandMessage.id) {
							const newCommandMessage = new1 as CommandMessage;
							newCommandMessage.previous = result;
							this.onCommand(newCommandMessage);
							await commandMessage.reactions.cache.get("✏")?.users.remove(this.discord?.user!);
							this.discord!.off("messageUpdate", handleMessageEdit);
						}
					};

					await commandMessage.react("✏");
					this.discord!.on("messageUpdate", handleMessageEdit);
					await sleep(seconds(15));
					if (!commandMessage.deleted)
						await commandMessage.reactions.cache.get("✏")?.users.remove(this.discord?.user!);
					this.discord!.off("messageUpdate", handleMessageEdit);
				});
			return;
		}

		for (const command of this.anythingCommands)
			command(commandMessage, ...args);
	}

	private async login () {
		this.discord = new Client();
		this.discord.on("error", console.error);
		this.discord.on("disconnect", console.error);
		const readyPromise = new Promise(resolve => this.discord!.once("ready", resolve));
		await this.discord.login(this.config.apis.discord.token);
		return readyPromise;
	}
	private async logout () {
		await this.discord?.destroy();
		delete this.discord;
	}

	private async pluginHookStart () {
		for (const pluginName in this.plugins) {
			const plugin = this.plugins[pluginName];
			const config = this.config.plugins[pluginName];
			(plugin as any).commandPrefix = this.commandPrefix;

			if (!plugin.shouldExist(config))
				continue;

			plugin.config = config ?? plugin.config ?? plugin.getDefaultConfig();

			// initial load of plugin data
			if (!plugin["loaded"]) {
				plugin["loaded"] = true;
				plugin.logger.verbose("Load data");
				await this.getApi<Data>("data")?.load(plugin)
					.catch(err => plugin.logger.warning(`Unable to load data`, err))
					?? {};
			}

			await this.pluginHook(pluginName, "onStart");
		}
	}

	private async pluginHookStop () {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName))
				continue;

			await this.pluginHook(pluginName, "onStop");
		}
	}

	private async pluginHook (pluginName: string, hook: "onStop" | "onStart") {
		try {
			await this.plugins[pluginName][hook]();
		} catch (err) {
			this.plugins[pluginName].logger.error(err);
			await this.stop();
		}
	}

	private pluginHookInit () {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName] as Plugin;
			plugin.user = this.discord!.user!;
			plugin.guild = this.guild;
			plugin.logger = new Logger(this.guild.name, plugin.getId());

			for (const property in plugin) {
				// import apis
				let metadata = Reflect.getMetadata(SYMBOL_IMPORT_API_KEY, plugin, property);
				if (metadata)
					(plugin as any)[property] = this.getApi(metadata);

				// import other plugins
				metadata = Reflect.getMetadata(SYMBOL_IMPORT_PLUGIN_KEY, plugin, property);
				if (metadata)
					(plugin as any)[property] = this.plugins[metadata];

				// import other plugins
				const pluginFilter = Reflect.getMetadata(SYMBOL_IMPORT_PLUGINS_KEY, plugin, property);
				if (pluginFilter)
					Object.defineProperty(plugin, property, { get: () => Object.values(this.plugins).filter(pluginFilter) });

			}
		}

		this.registerCommand(["plugin", "update"], this.commandUpdatePlugin);
		this.registerCommand(["plugin", "data", "reset"], this.commandResetPluginData);
		this.registerCommand(["help"], this.commandHelp);
		this.registerCommand(["restart"], this.commandRestart);
		this.registerCommand(["backup"], this.commandBackup);

		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName] as any;
			let proto = plugin.__proto__;
			const properties = new Set<string>();
			while (proto !== ({}).constructor.prototype) {
				properties.addFrom(Object.getOwnPropertyNames(proto));
				proto = proto.__proto__;
			}

			for (const property of properties) {
				let [commands, condition]: CommandMetadata = Reflect.getMetadata(SYMBOL_COMMAND, plugin, property) || [];
				if (typeof commands === "function")
					commands = commands(plugin);

				for (const command of Array.isArray(commands) ? commands : [commands]) {
					if (command && (!condition || condition(plugin))) {
						const alreadyExisted = this.registerCommand(command.split(" "), plugin[property].bind(plugin), undefined, pluginName);
						const logText = `command '${chalk.magenta(`!${command}`)}'`;
						if (alreadyExisted)
							plugin.logger.warning(`Re-registered ${logText}`);
						else
							plugin.logger.verbose(`Registered ${logText}`);
					}
				}
			}
		}
	}

	@Bound
	private async commandBackup (message: CommandMessage) {
		const canRunCommand = message.author.id === "92461141682307072" // Chiri is all-powerful
			|| message.member?.permissions.has("ADMINISTRATOR");

		if (canRunCommand) {
			await message.author.send(`Making a backup...`);
			const madebackup = await this.getApi<Data>("data")?.backup();
			message.author.send(madebackup ? "Successfully backed-up save data." : "Failed to create a backup.");
		}

		return CommandResult.pass();
	}

	@Bound
	private async commandRestart (message: CommandMessage, allStr?: string) {
		const all = allStr === "all";
		const canRunCommand = message.author.id === "92461141682307072" // Chiri is all-powerful
			|| (!all && message.member?.permissions.has("ADMINISTRATOR"));

		if (canRunCommand) {
			await message.reply(`restarting${all ? " every instance" : ""}...`);
			this.event.emit("restart", all);
		}

		return CommandResult.pass();
	}

	@Bound
	private commandHelp (message: CommandMessage) {
		Stream.from(this.commands.get("help")?.subcommands)
			.map(([name, command]) => tuple(name, command, this.plugins[command.plugin!] as Plugin | undefined))
			.partition(([, , plugin]) => plugin)
			.partitions()
			.filter(([plugin]) => plugin?.isHelpVisible(message.author))
			.map(([plugin, commands]) => `\`${this.commandPrefix}help ${commands.map(([name]) => name).toString("|")}\`\n${plugin!.getDescription() || ""}`.trim())
			.collect(Paginator.create)
			.reply(message);

		return CommandResult.pass();
	}

	@Bound
	private commandUpdatePlugin (message: CommandMessage, pluginName: string) {
		if (!message.member?.permissions.has("ADMINISTRATOR") && message.author.id !== "92461141682307072") // Chiri is all-powerful
			return CommandResult.pass();

		const plugin = this.plugins[pluginName];
		if (!plugin) {
			return message.reply(`can't update plugin ${pluginName}, not found.`)
				.then(reply => CommandResult.fail(message, reply));
		}

		plugin.logger.info(`Updating due to request from ${message.member?.displayName}`);
		this.updatePlugin(plugin);
		plugin.reply(message, `updated plugin ${pluginName}.`);
		return CommandResult.pass();
	}

	@Bound
	private commandResetPluginData (message: CommandMessage, pluginName: string) {
		if (!message.member?.permissions.has("ADMINISTRATOR") && message.author.id !== "92461141682307072") // Chiri is all-powerful
			return CommandResult.pass();

		const plugin = this.plugins[pluginName];
		if (!plugin) {
			return message.reply(`can't reset data for plugin ${pluginName}, not found.`)
				.then(reply => CommandResult.fail(message, reply));
		}

		plugin.logger.info(`Resetting data due to request from ${message.member?.displayName}`);
		plugin.data.reset();
		plugin.reply(message, `reset data for plugin ${pluginName}.`);
		return CommandResult.pass();
	}

	private registerCommand (words: string[], commandFunction: CommandFunction, commandMap = this.commands, pluginId?: string) {
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
				command.plugin = pluginId;
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

	private async pluginHookMessage (message: Message) {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName];
			if (plugin.onMessage)
				plugin.onMessage(message);

			plugin.data.saveOpportunity();
		}
	}

	private async pluginHookEdit (oldMessage: Message, message: Message) {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName];
			if (plugin.onEdit)
				plugin.onEdit(message, oldMessage);

			plugin.data.saveOpportunity();
		}
	}

	private async pluginHookReaction (reaction: MessageReaction, member: GuildMember) {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName];
			if (plugin.onReaction)
				plugin.onReaction(reaction, member);

			plugin.data.saveOpportunity();
		}
	}

	private async pluginHookDelete (message: Message) {
		for (const pluginName in this.plugins) {
			if (this.isDisabledPlugin(pluginName)) continue;

			const plugin = this.plugins[pluginName];
			if (plugin.onDelete)
				plugin.onDelete(message);

			plugin.data.saveOpportunity();
		}
	}

	private isDisabledPlugin (id: string) {
		const plugin = this.plugins[id];
		return !(plugin instanceof ExternalPlugin) && !plugin.shouldExist(this.config.plugins[id]);
	}

	// private async catastrophicCrash (...args: any[]) {
	// 	this.log(...args);
	// 	await this.logout();
	// 	await this.stop();
	// 	while (true)
	// 		await sleep(99999999);
	// }
}
