import { Channel, Collection, ColorResolvable, DMChannel, Emoji, Guild, GuildEmoji, GuildMember, Message, MessageEmbed, MessageReaction, NewsChannel, ReactionEmoji, Role, TextChannel, User } from "discord.js";
import { EventEmitterAsync, sleep } from "../util/Async";
import { minutes, never, seconds, TimeUnit } from "../util/Time";
import { CommandMessage } from "./Api";
import HelpContainerPlugin, { HelpContainerCommand } from "./Help";
import { IInherentImportableData, Importable } from "./Importable";

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

export interface IInherentPluginData<CONFIG = {}> extends IInherentImportableData<CONFIG> {
	_lastUpdate?: number;
}

export abstract class Plugin<CONFIG extends {} = any, DATA extends IInherentPluginData<CONFIG> = IInherentPluginData<CONFIG>>
	extends Importable<CONFIG & IPluginConfig, DATA> {

	public event = new EventEmitterAsync();

	public updateInterval = never();
	public get lastUpdate () { return this.data._lastUpdate ?? 0; }
	public set lastUpdate (value: number) {
		this.data.set("_lastUpdate", value);
		this.data.markDirty();
	}

	public lastAutosave = 0;

	public guild: Guild;
	public user: User;

	// @ts-ignore
	private loaded = false;
	/**
	 * The current command prefix, configured instance-wide. It's only for reference, changing this would do nothing
	 */
	protected readonly commandPrefix: string;

	public async save () {
		return this.data.save();
	}

	public getDefaultConfig (): CONFIG & IPluginConfig {
		this.logger.warning("No default config");
		return {} as any;
	}

	public getDescription (): string | undefined {
		return undefined;
	}

	public shouldExist (config: false | (CONFIG & IPluginConfig)) {
		return config !== false;
	}

	public isHelpVisible (author: User) {
		return true;
	}

	/* hooks */
	public onUpdate () { }
	public onStart () { }
	public onStop () { }
	public onMessage (message: Message) { }
	public onEdit (message: Message, oldMessage: Message) { }
	public onDelete (message: Message) { }
	public onReaction (messageReaction: MessageReaction, member: GuildMember) { }

	// private async onStartInternal (api: IInjectionApi<Plugin, "onStart", "pre">) {
	// 	this.pronounRoles = {
	// 		"she/her": await this.findRole("she/her"),
	// 		"he/him": await this.findRole("he/him", false),
	// 		"they/them": await this.findRole("they/them", false),
	// 		"it/its": await this.findRole("it/its", false),
	// 	};
	// }

	public async reply (message: CommandMessage, reply: string | MessageEmbed | HelpContainerPlugin | HelpContainerCommand): Promise<ArrayOr<Message>>;
	public async reply (message: CommandMessage, reply: string, embed?: MessageEmbed): Promise<ArrayOr<Message>>;
	public async reply (message: CommandMessage, reply?: string | MessageEmbed | HelpContainerPlugin | HelpContainerCommand, embed?: MessageEmbed) {
		if (reply instanceof HelpContainerPlugin)
			return reply.getPaginator(this.commandPrefix)
				.reply(message);

		if (reply instanceof HelpContainerCommand)
			reply = new MessageEmbed()
				.setDescription(reply.getDisplay(this.commandPrefix));

		// if (typeof reply === "string") {
		// 	reply = reply.trim();
		// 	if (!message.guild)
		// 		reply = reply ? reply[0].toUpperCase() + reply.slice(1) : reply;
		// else
		// 	reply = `<@${message.author.id}>, ${reply}`;
		// }

		let textContent = typeof reply === "string" ? reply : undefined; // message.channel instanceof DMChannel ? undefined : `<@${message.author.id}>`;
		const embedContent = typeof reply === "string" ? embed : reply;

		if (message.previous?.output[0])
			return message.previous?.output[0].edit(textContent, { embed: embedContent })
				.then(async result => {
					for (let i = 1; i < (message.previous?.output.length || 0); i++)
						message.previous?.output[i].delete();

					return result;
				});

		return message.channel.send(textContent, { embed: embedContent, replyTo: message });
	}

	protected getName (user: User | GuildMember | Message) {
		if (user instanceof Message)
			user = user.member ?? user.author;

		const member = user instanceof GuildMember ? user : this.guild.members.cache.get(user.id);
		user = user instanceof GuildMember ? user.user : user;
		return member?.displayName ?? user.username;
	}

	/**
	 * @param query Can be an ID, a tag, part of a display name, or part of a username
	 * @returns undefined if no members match, the matching Collection of members if multiple members match,
	 * and the matching member if one member matches
	 */
	protected async findMember (query: string): Promise<GuildMember | Collection<string, GuildMember> | undefined> {
		const results = await this.findMembers(query);
		switch (results.size) {
			case 0: return undefined;
			case 1: return results.first();
			default: return results;
		}
	}

	/**
	 * @param query Can be an ID, a tag, part of a display name, or part of a username
	 * @returns undefined if no members match, the matching Collection of members if multiple members match,
	 * and the matching member if one member matches
	 */
	protected async findMembers (query: string) {
		query = query.toLowerCase();
		let tag: string | undefined;

		const splitMatch = query.match(/^(.*)(#\d{4})$/);
		if (splitMatch)
			[, query, tag] = splitMatch;

		await this.guild.members.fetch({ force: true });
		let results = this.guild.members.cache.filter(m => m.id === query);
		if (!results.size)
			results = this.guild.members.cache.filter(m => m.user.username.toLowerCase().includes(query));

		if (!results.size)
			results = this.guild.members.cache.filter(m => m.displayName.toLowerCase().includes(query));

		if (tag)
			results = results.filter(m => m.user.tag.endsWith(tag!));

		return results;
	}

	/**
	 * @param role A role ID or name
	 * @returns undefined if no members match, the matching Collection of members if multiple members match,
	 * and the matching member if one member matches
	 */
	protected findRole (role: string): Promise<Role | undefined>;
	protected findRole (role: string, fetch: false): Role | undefined;
	protected findRole (role: string, fetch = true): Role | undefined | Promise<Role | undefined> {
		if (!this.guild)
			return;

		if (fetch)
			return this.guild.roles.fetch(undefined, undefined, true)
				.then(() => this.findRole(role, false));

		return this.guild.roles.cache.get(role)
			?? this.guild.roles.cache.find(r => r.name === role)
			?? this.guild.roles.cache.find(r => r.name.toLowerCase() === role.toLowerCase());
	}

	protected validateFindResult (result: GuildMember | Collection<string, GuildMember> | undefined): { error: string, member?: undefined } | { member: GuildMember, error?: undefined } {
		if (result instanceof Collection)
			return { error: "I found multiple members with that name. Can you be more specific?" };

		if (!result)
			return { error: "I couldn't find a member by that name." };

		return { member: result };
	}

	protected async sendAll (channelOrReplyMessage: TextChannel | DMChannel | NewsChannel | Message, ...lines: (string | 0 | undefined | null)[]) {
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
				await outputMessage?.reactions.removeAll();
	}

	protected promptReaction (reply: string | ArrayOr<Message>) {
		let options: [string | GuildEmoji, string?][] = [];
		let timeout = minutes(5);
		const self = this;
		let _title: string | undefined;
		let _image: string | undefined;
		let _description: string | undefined;
		let _url: string | undefined;

		return {
			setIdentity (title?: string, image?: string) {
				_title = title;
				_image = image;
				return this;
			},
			setURL (url?: string) {
				_url = url;
				return this;
			},
			setDescription (description?: string) {
				_description = description;
				return this;
			},
			addOption (option?: string | GuildEmoji | false | 0 | null, definition?: string) {
				if (option)
					options.push([option, definition]);
				return this;
			},
			addOptions (...options: (readonly [string | GuildEmoji, string?])[]) {
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
			async reply (message: CommandMessage | User): Promise<{ message: Message, response: GuildEmoji | ReactionEmoji | undefined }> {
				const optionDefinitions = options.map(([emoji, definition]) => `${emoji} \u200b ${definition}`);

				if (Array.isArray(reply))
					reply = reply[0];

				reply = reply instanceof Message ? reply : await self.reply(message as CommandMessage, new MessageEmbed()
					.setAuthor(_title, _image)
					.setTitle(reply)
					.setURL(_url)
					.setDescription(_description)
					.addField("\u200b", optionDefinitions.join(" \u200b · \u200b "))) as Message;

				let ended = false;
				(async () => {
					for (const [emoji] of options)
						if (!ended)
							await reply.react(emoji);
				})();

				const collected = await reply.awaitReactions((react, user) =>
					user.id === (message instanceof Message ? message.author : message).id
					&& options.some(([emoji]) => emoji === (emoji instanceof Emoji ? react.emoji : react.emoji.name)),
					{ max: 1, time: timeout });

				ended = true;

				let result: GuildEmoji | ReactionEmoji | undefined = collected?.first()?.emoji;

				if (!result || result.name === "❌") {
					// const cancelledMessage = `Interactable ${result ? "closed" : "timed out"}.`;
					result = undefined;
					// await reply.edit(typeof prompt !== "string" ? "" : `${reply.content}\n\n_${cancelledMessage}_`,
					// 	typeof prompt === "string" ? undefined : new RichEmbed()
					// 		.inherit(reply.embeds[0])
					// 		.setFooter(cancelledMessage));

					if (!(reply.channel instanceof DMChannel))
						await reply.reactions.removeAll();
				}

				return { message: reply, response: result };
			},
		};
	}

	protected yesOrNo (text = "", embed?: MessageEmbed) {
		if (!text && !embed)
			throw new Error("No message content.");

		let timeout = minutes(5);
		const self = this;

		async function handleMessage (message: Message, whitelistedUser?: User) {
			let ended = false;
			(async () => {
				await message.react("✅");
				if (!ended)
					await message.react("❌");
			})();

			const collected = await message.awaitReactions((react, user) =>
				user.id !== message.author.id
				&& (!whitelistedUser || user.id === whitelistedUser.id)
				&& (react.emoji.name === "❌"
					|| react.emoji.name === "✅"),
				{ max: 1, time: timeout });

			ended = true;

			const result = collected?.first();
			return result ? result.emoji.name === "✅" : false;
		}

		return {
			setTimeout (t: number) {
				timeout = t;
				return this;
			},
			async send (to: User | GuildMember | TextChannel) {
				const message = await to.send(text!, embed) as Message;
				return handleMessage(message);
			},
			async reply (message: CommandMessage) {
				const reply = await self.reply(message, text!, embed) as Message;
				return handleMessage(reply, message.author);
			},
		};
	}

	protected prompter (prompt: string) {
		let defaultValue: string | undefined;
		let deletable = false;
		let timeout = minutes(5);
		let validator: ((value: Message) => true | string | undefined) | undefined;
		const self = this;
		let _title: string | undefined;
		let _url: string | undefined;
		let _image: string | undefined;
		let _description: string | undefined;
		let _maxLength: number | undefined;
		let _color: ColorResolvable | undefined;
		let _thumbnail: string | undefined;

		type Result = { cancelled: true }
			| {
				cancelled: false;
				message?: Message;
				reaction?: MessageReaction;
				value?: string;
				apply<T extends { [key in K]?: string | undefined }, K extends keyof T> (to: T, prop: K): void;
			};

		return {
			setIdentity (title?: string, image?: string) {
				_title = title;
				_image = image;
				return this;
			},
			setURL (url?: string) {
				_url = url;
				return this;
			},
			setThumbnail (url?: string) {
				_thumbnail = url;
				return this;
			},
			setDescription (description?: string) {
				_description = description;
				return this;
			},
			setDefaultValue (d?: string) {
				defaultValue = d;
				return this;
			},
			setDeletable () {
				deletable = true;
				return this;
			},
			setColor (color: ColorResolvable) {
				_color = color;
				return this;
			},
			setMaxLength (maxLength: number) {
				_maxLength = maxLength;
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
			async reply (message: CommandMessage): Promise<Result> {
				if (defaultValue === "")
					deletable = false;

				const reply = await self.reply(message, new MessageEmbed()
					.setColor(_color)
					.setURL(_url)
					.setThumbnail(_thumbnail)
					.setAuthor(_title, _image)
					.setTitle(prompt)
					.setDescription(_description)
					.addFields(
						!_maxLength ? undefined : { name: "Max length", value: `${_maxLength} characters` },
						!defaultValue ? undefined : { name: "Current response", value: defaultValue },
					)
					.addField("\u200b", [
						"Send a message with your response",
						defaultValue === undefined ? undefined : `✅ \u200b Use ${defaultValue ? `current` : "no"} response`,
						!deletable ? undefined : "🗑 \u200b Use no response",
						"❌ \u200b Cancel",
					].filterNullish().join(" \u200b · \u200b "))) as Message;

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

					message.channel.clearAwaitingMessages();

					const result = collected?.first();
					if (result instanceof Message) {
						if (_maxLength !== undefined && result.content.length > _maxLength) {
							await message.reply(`Response too long by **${result.content.length - _maxLength} characters** — max length is **${_maxLength}**.`);
							continue;
						}

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
						message: result instanceof Message ? result : undefined,
						reaction: result && !(result instanceof Message) ? result : undefined,
						get value () {
							if (result instanceof Message)
								return result.content;
							else if (result?.emoji.name === "✅")
								return defaultValue;
							else
								return undefined;
						},
						apply (to: any, prop) {
							const value = this.value;
							if (value)
								to[prop] = value;
							else
								delete to[prop];
						},
					};
				}
			},
		};
	}

	protected async getReactors (message: Message): Promise<Set<User>>;
	protected async getReactors (message: string, channel: TextChannel): Promise<Set<User>>;
	protected async getReactors (message: Message | string, channel?: TextChannel) {
		message = message instanceof Message ? message : await channel!.messages.fetch(message);

		const users = new Set<User>();
		for (const reaction of message.reactions.cache.values())
			for (const user of (await reaction.users.fetch()).values())
				users.add(user);

		return users;
	}

	protected async getMessage (channel: TextChannel | DMChannel | NewsChannel | string | undefined, messageId: string) {
		if (typeof channel === "string")
			channel = this.guild.channels.cache.get(channel) as TextChannel;

		if (!channel || !(channel instanceof TextChannel))
			return undefined;

		return channel.messages.fetch(messageId)
			.catch(() => undefined);
	}

	protected async ensureMember (message: Message) {
		if (message.member)
			return true;

		let member = this.guild.members.cache.get(message.author.id);
		if (!member)
			member = await this.guild.members.fetch(message.author.id);

		if (!member)
			return false;

		Object.defineProperty(message, "member", { value: member, configurable: true });
		return true;
	}

	public mentionRole (role: Role, channel?: Channel) {
		if (channel instanceof DMChannel)
			return `@${role.name}`;

		return `<@&${role.id}>`;
	}
}
