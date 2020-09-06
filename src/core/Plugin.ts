import { Collection, DMChannel, Emoji, GroupDMChannel, Guild, GuildMember, Message, ReactionEmoji, RichEmbed, Role, TextChannel, User } from "discord.js";
import { EventEmitterAsync, sleep } from "../util/Async";
import Data, { FullDataContainer } from "../util/Data";
import { IInjectionApi, Injector } from "../util/function/Inject";
import Logger from "../util/Log";
import { getTime, hours, minutes, never, seconds, TimeUnit } from "../util/Time";
import { CommandMessage, ImportApi } from "./Api";
import HelpContainerPlugin, { HelpContainerCommand } from "./Help";
import { Importable } from "./Importable";

enum Pronouns {
	"she/her",
	"he/him",
	"they/them",
	"it/its",
}

const pronounLanguage: Record<keyof typeof Pronouns, { they: string, are: string, them: string, their: string, theirs: string }> = {
	"she/her": { they: "she", are: "is", them: "her", their: "her", theirs: "her" },
	"he/him": { they: "he", are: "is", them: "him", their: "his", theirs: "his" },
	"it/its": { they: "it", are: "is", them: "it", their: "its", theirs: "its" },
	"they/them": { they: "they", are: "are", them: "them", their: "their", theirs: "theirs" },
};


export interface IPluginConfig {
	updateInterval?: string | [TimeUnit, number];
	// autosaveInterval?: string | [TimeUnit, number];
}

export interface IExternalPluginConfig extends IPluginConfig {
	classFile: string;
}

export interface IGetApi<T> {
	(name: string): T;
}

export abstract class Plugin<CONFIG extends {} = any, DATA = {}>
	extends Importable<CONFIG & IPluginConfig> {

	public event = new EventEmitterAsync();

	public updateInterval = never();
	public lastUpdate = 0;
	public autosaveInterval = hours(2);
	public lastAutosave = 0;

	public guild: Guild;
	public user: User;
	public logger: Logger;

	@ImportApi("data")
	protected dataApi: Data = undefined!;

	private _data: FullDataContainer<DATA & { _lastUpdate?: number }>;

	public get data () {
		if (!this._data)
			this._data = this.dataApi.createContainer<DATA & { _lastUpdate?: number }>((self => ({
				get dataPath () { return self.getId(); },
				get autosaveInterval () { return self.autosaveInterval; },
				initData: () => ({ ...this.initData?.(), _lastUpdate: this.lastUpdate } as any),
			}))(this))
				.event.subscribe("save", () => this.logger.verbose("Saved"))!;

		return this._data as FullDataContainer<DATA>;
	};

	// @ts-ignore
	private loaded = false;
	/**
	 * The current command prefix, configured instance-wide. It's only for reference, changing this would do nothing
	 */
	// @ts-ignore
	protected readonly commandPrefix: string;

	private _config: CONFIG & IPluginConfig;
	public get config () { return this._config; }
	public set config (cfg: CONFIG & IPluginConfig) {
		this._config = cfg;

		if (cfg && cfg.updateInterval) {
			this.updateInterval = getTime(cfg.updateInterval);
		}

		// if (cfg && cfg.autosaveInterval) {
		// 	this.autosaveInterval = getTime(cfg.autosaveInterval);
		// }
	}

	public constructor () {
		super();
		Injector.into<Plugin, "onStart", "pre">(null, "onStart", "pre")
			.inject(this, this.onStartInternal);
		Injector.register(this.constructor as Class<this>, this);
	}

	protected abstract initData: {} extends DATA ? (() => DATA) | undefined : () => DATA;

	public async save () {
		this._data.data!._lastUpdate = this.lastUpdate;
		return this.data.save();
	}

	public getDefaultConfig (): CONFIG & IPluginConfig {
		this.logger.warning("No default config");
		return {} as any;
	}

	public getDescription (): string | undefined {
		return undefined;
	}

	public isHelpVisible (author: User) {
		return true;
	}

	/* hooks */
	public onUpdate () { }
	public onStart () { }
	public onStop () { }
	public onMessage (message: Message) { }

	private pronounRoles: Record<keyof typeof Pronouns, Role | undefined>;

	private async onStartInternal (api: IInjectionApi<Plugin, "onStart", "pre">) {
		this.pronounRoles = {
			"she/her": await this.findRole("she/her"),
			"he/him": await this.findRole("he/him", false),
			"they/them": await this.findRole("they/them", false),
			"it/its": await this.findRole("it/its", false),
		};
	}

	public async reply (message: CommandMessage, reply: string | RichEmbed | HelpContainerPlugin | HelpContainerCommand): Promise<ArrayOr<Message>>;
	public async reply (message: CommandMessage, reply: string, embed?: RichEmbed): Promise<ArrayOr<Message>>;
	public async reply (message: CommandMessage, reply?: string | RichEmbed | HelpContainerPlugin | HelpContainerCommand, embed?: RichEmbed) {
		if (reply instanceof HelpContainerPlugin)
			return reply.getPaginator(this.commandPrefix)
				.reply(message);

		if (reply instanceof HelpContainerCommand)
			reply = new RichEmbed()
				.setDescription(reply.getDisplay(this.commandPrefix));

		if (typeof reply === "string") {
			reply = reply.trim();
			if (!message.guild)
				reply = reply[0].toUpperCase() + reply.slice(1);
			else
				reply = `<@${message.author.id}>, ${reply}`;
		}

		let textContent = typeof reply === "string" ? reply : message.channel instanceof DMChannel ? undefined : `<@${message.author.id}>`;
		const embedContent = typeof reply === "string" ? embed : reply;

		if (message.previous?.output[0])
			return message.previous?.output[0].edit(textContent, embedContent)
				.then(async result => {
					for (let i = 1; i < (message.previous?.output.length || 0); i++)
						message.previous?.output[i].delete();

					return result;
				});

		return message.channel.send(textContent, embedContent);
	}

	protected getName (user: User | GuildMember) {
		const member = user instanceof GuildMember ? user : this.guild.members.get(user.id);
		user = user instanceof GuildMember ? user.user : user;
		return member?.displayName ?? user.username;
	}

	/**
	 * @param member Can be an ID, a tag, part of a display name, or part of a username
	 * @returns undefined if no members match, the matching Collection of members if multiple members match,
	 * and the matching member if one member matches
	 */
	protected async findMember (member: string): Promise<GuildMember | Collection<string, GuildMember> | undefined> {
		member = member.toLowerCase();
		let tag: string | undefined;

		const splitMatch = member.match(/^(.*)(#\d{4})$/);
		if (splitMatch)
			[, member, tag] = splitMatch;

		const guild = await this.guild.fetchMembers();
		let results = guild.members.filter(m => m.id === member);
		if (!results.size)
			results = guild.members.filter(m => m.user.username.toLowerCase().includes(member));

		if (!results.size)
			results = guild.members.filter(m => m.displayName.toLowerCase().includes(member));

		if (tag)
			results = results.filter(m => m.user.tag.endsWith(tag!));

		switch (results.size) {
			case 0: return undefined;
			case 1: return results.first();
			default: return results;
		}
	}

	protected getPronouns (member: User | GuildMember): (typeof pronounLanguage)[keyof typeof Pronouns] {
		if (member instanceof User) {
			member = this.guild.members.get(member.id)!;
			if (!member)
				return pronounLanguage["they/them"];
		}

		// const pronouns: (keyof typeof Pronouns)[] = [
		// 	this.pronounRoles["she/her"]?.id && member.roles.has(this.pronounRoles["she/her"]?.id) && "she/her" as const,
		// 	this.pronounRoles["he/him"]?.id && member.roles.has(this.pronounRoles["he/him"]?.id) && "he/him" as const,
		// 	this.pronounRoles["it/its"]?.id && member.roles.has(this.pronounRoles["it/its"]?.id) && "it/its" as const,
		// 	this.pronounRoles["they/them"]?.id && member.roles.has(this.pronounRoles["they/them"]?.id) && "they/them" as const,
		// ].filterFalsey(true);

		const pronouns: Record<keyof typeof Pronouns, boolean | "" | undefined> = {
			"she/her": this.pronounRoles["she/her"]?.id && member.roles.has(this.pronounRoles["she/her"]?.id),
			"he/him": this.pronounRoles["he/him"]?.id && member.roles.has(this.pronounRoles["he/him"]?.id),
			"they/them": this.pronounRoles["they/them"]?.id && member.roles.has(this.pronounRoles["they/them"]?.id),
			"it/its": this.pronounRoles["it/its"]?.id && member.roles.has(this.pronounRoles["it/its"]?.id),
		};

		const count = +Boolean(pronouns["she/her"]) + +Boolean(pronouns["he/him"]) + +Boolean(pronouns["it/its"]);
		if (!count || (count > 1 && pronouns["they/them"]))
			return pronounLanguage["they/them"];

		return pronounLanguage[pronouns["she/her"] ? "she/her"
			: pronouns["he/him"] ? "he/him"
				: pronouns["it/its"] ? "it/its"
					: "they/them"];
	}

	/**
	 * @param role A role ID or name
	 * @returns undefined if no members match, the matching Collection of members if multiple members match,
	 * and the matching member if one member matches
	 */
	protected async findRole (role: string, fetch = true): Promise<Role | undefined> {
		if (!this.guild)
			return;

		const guild = fetch ? await this.guild.fetchMembers() : this.guild;

		return guild.roles.find(r => r.id === role)
			?? guild.roles.find(r => r.name === role)
			?? guild.roles.find(r => r.name.toLowerCase() === role.toLowerCase());
	}

	protected validateFindResult (result: GuildMember | Collection<string, GuildMember> | undefined): { error: string, member?: undefined } | { member: GuildMember, error?: undefined } {
		if (result instanceof Collection)
			return { error: "I found multiple members with that name. Can you be more specific?" };

		if (!result)
			return { error: "I couldn't find a member by that name." };

		return { member: result };
	}

	protected async sendAll (channelOrReplyMessage: TextChannel | DMChannel | GroupDMChannel | Message, ...lines: (string | 0 | undefined | null)[]) {
		// lines = lines.map(line => line.split("\n")).flat();
		const messages: string[] = [""];
		for (let line of lines) {
			if (typeof line !== "string")
				// skip non-string lines
				continue;

			line = `${line}\n`;
			if (messages.last()!.length + line.length >= 2000)
				messages.push("");

			messages[messages.length - 1] += line;
		}

		const channel = channelOrReplyMessage instanceof Message ? channelOrReplyMessage.channel : channelOrReplyMessage;
		const replyTo = channelOrReplyMessage instanceof Message ? channelOrReplyMessage as CommandMessage : undefined;

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];

			if (i === 0 && replyTo?.previous?.output[i])
				replyTo.previous.output[i].edit(message);
			else
				channel.send(message);

			await sleep(seconds(1));
		}
	}

	protected async clearReactions (message: CommandMessage) {
		const output = message.previous?.output.flat();
		if (!output?.length)
			return;

		if (message.channel instanceof DMChannel) {
			for (const outputMessage of output)
				await outputMessage?.delete();

			delete message.previous;
		}
		else
			for (const outputMessage of output)
				await outputMessage?.clearReactions();
	}

	protected promptReaction (prompt: string | RichEmbed) {
		let options: [string | Emoji, string?][] = [];
		let timeout = minutes(5);
		const self = this;

		return {
			addOption (option?: string | Emoji | false | 0 | null, definition?: string) {
				if (option)
					options.push([option, definition]);
				return this;
			},
			addOptions (...options: (readonly [string | Emoji, string?])[]) {
				for (const [emoji, definition] of options)
					this.addOption(emoji, definition);
				return this;
			},
			addCancelOption () {
				this.addOption("❌", "Cancel");
				return this;
			},
			setTimeout (t: number) {
				timeout = t;
				return this;
			},
			async reply (message: CommandMessage): Promise<{ message: Message, response: Emoji | ReactionEmoji | undefined }> {
				const optionDefinitions = options.map(([emoji, definition]) => `\n  ${emoji} — ${definition}`);

				if (typeof prompt === "string")
					prompt = `${prompt}${optionDefinitions}`;
				// else
				// 	prompt = prompt
				// 		.setFooter(optionDefinitions);

				const reply = await self.reply(message, prompt) as Message;

				let ended = false;
				(async () => {
					for (const [emoji] of options)
						if (!ended)
							await reply.react(emoji);
				})();

				const collected = await reply.awaitReactions((react, user) =>
					user.id === message.author.id
					&& options.some(([emoji]) => emoji === (emoji instanceof Emoji ? react.emoji : react.emoji.name)),
					{ max: 1, time: timeout });

				ended = true;

				let result: Emoji | ReactionEmoji | undefined = collected?.first()?.emoji;

				if (!result || result.name === "❌") {
					// const cancelledMessage = `Interactable ${result ? "closed" : "timed out"}.`;
					result = undefined;
					// await reply.edit(typeof prompt !== "string" ? "" : `${reply.content}\n\n_${cancelledMessage}_`,
					// 	typeof prompt === "string" ? undefined : new RichEmbed()
					// 		.inherit(reply.embeds[0])
					// 		.setFooter(cancelledMessage));

					if (!(message.channel instanceof DMChannel))
						await reply.clearReactions();
				}

				return { message: reply, response: result };
			},
		};
	}

	protected yesOrNo (text?: string, embed?: RichEmbed) {
		if (!text && !embed)
			throw new Error("No message content.");

		let timeout = minutes(5);
		const self = this;

		return {
			setTimeout (t: number) {
				timeout = t;
				return this;
			},
			async reply (message: CommandMessage) {
				const reply = await self.reply(message, text!, embed) as Message;

				let ended = false;
				(async () => {
					await reply.react("✅");
					if (!ended)
						await reply.react("❌");
				})();

				const collected = await reply.awaitReactions((react, user) =>
					user.id === message.author.id
					&& (react.emoji.name === "❌"
						|| react.emoji.name === "✅"),
					{ max: 1, time: timeout });

				ended = true;

				const result = collected?.first();
				return result && result.emoji.name === "✅";
			},
		};
	}

	protected prompter (prompt: string) {
		let defaultValue: string | undefined;
		let deletable = false;
		let timeout = minutes(5);
		let validator: ((value: Message) => true | string | undefined) | undefined;
		const self = this;

		return {
			setDefaultValue (d?: string) {
				defaultValue = d;
				return this;
			},
			setDeletable () {
				deletable = true;
				return this;
			},
			setValidator (v: (value: Message) => true | string | undefined) {
				validator = v;
				return this;
			},
			setTimeout (t: number) {
				timeout = t;
				return this;
			},
			async reply (message: CommandMessage): Promise<
				{ cancelled: true }
				| { cancelled: false, apply<T extends { [key in K]?: string | undefined }, K extends keyof T> (to: T, prop: K): void }
			> {
				if (defaultValue === "")
					deletable = false;

				const currentValuePrompt = defaultValue !== undefined ? ` Currently:\n> ${defaultValue.replace(/\n/g, "\n> ")}` : "";
				const defaultValuePrompt = defaultValue !== undefined ? `\n✅ — Use ${defaultValue ? `current` : "No"} value` : "";
				const deletablePrompt = deletable ? "\n🗑 — Use no value" : "";
				const reply = await self.reply(message, `${prompt}${currentValuePrompt}${defaultValuePrompt}${deletablePrompt}\n❌ — Cancel`) as Message;

				let ended = false;
				(async () => {
					if (defaultValue !== undefined)
						await reply.react("✅");

					if (deletable && !ended)
						await reply.react("🗑");

					if (!ended)
						await reply.react("❌");
				})();

				while (true) {
					const collected = await Promise.race([
						message.channel.awaitMessages(nm => nm.author.id === message.author.id, { max: 1, time: timeout }),
						reply.awaitReactions((react, user) =>
							user.id === message.author.id
							&& (react.emoji.name === "❌"
								|| react.emoji.name === "✅"
								|| react.emoji.name === "🗑"),
							{ max: 1, time: timeout }),
					]);

					const result = collected?.first();
					if (result instanceof Message) {
						const validationResult = validator?.(result);
						if (typeof validationResult === "string") {
							await message.reply(`Invalid response. ${validationResult}`);
							continue;
						}
					}

					ended = true;

					if (!result || (!(result instanceof Message) && result.emoji.name === "❌"))
						return { cancelled: true };

					return {
						cancelled: false,
						apply (to: any, prop) {
							if (result instanceof Message)
								to[prop] = result.content;
							else if (result.emoji.name === "✅")
								to[prop] = defaultValue;
							else
								delete to[prop];
						}
					};
				}
			},
		};
	}

	protected async getReactors (message: Message): Promise<Set<User>>;
	protected async getReactors (message: string, channel: TextChannel): Promise<Set<User>>;
	protected async getReactors (message: Message | string, channel?: TextChannel) {
		message = message instanceof Message ? message : await channel!.fetchMessage(message);

		const users = new Set<User>();
		for (const reaction of message.reactions.values())
			for (const user of (await reaction.fetchUsers()).values())
				users.add(user);

		return users;
	}

	protected async getMessage (channel: TextChannel | DMChannel | GroupDMChannel | string | undefined, messageId: string) {
		if (typeof channel === "string")
			channel = this.guild.channels.get(channel) as TextChannel;

		if (!channel || !(channel instanceof TextChannel))
			return undefined;

		return channel.fetchMessage(messageId)
			.catch(() => undefined);
	}
}
