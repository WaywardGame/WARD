import { APIMessage, Collection, CollectorFilter, ColorResolvable, DMChannel, EmbedFieldData, Message, MessageEmbed, MessageOptions, NewsChannel, Role, TextChannel } from "discord.js";
import Arrays from "../util/Arrays";
import Bound from "../util/Bound";
import Regex from "../util/Regex";
import { Importable } from "./Importable";
import { Plugin } from "./Plugin";

export abstract class Api<CONFIG extends object = {}> extends Importable<CONFIG> {
	protected initData = undefined;
}

export const SYMBOL_IMPORT_API_KEY = Symbol("import-api");
export function ImportApi (toImport: string) {
	return Reflect.metadata(SYMBOL_IMPORT_API_KEY, toImport);
}

export const SYMBOL_IMPORT_PLUGIN_KEY = Symbol("import-plugin");
export function ImportPlugin (toImport: string) {
	return Reflect.metadata(SYMBOL_IMPORT_PLUGIN_KEY, toImport);
}

export const SYMBOL_IMPORT_PLUGINS_KEY = Symbol("import-plugins");
export function ImportPlugins (filter: (plugin: Plugin) => boolean) {
	return Reflect.metadata(SYMBOL_IMPORT_PLUGINS_KEY, filter);
}

export type CommandMessage = Message & {
	command: string;
	args: string[];
	previous?: CommandResult;
};

export interface CommandResult {
	type: "pass" | "fail" | "mid";
	commandMessage?: CommandMessage;
	output: Message[];
}

export interface IField {
	name: string;
	value: string;
	inline?: boolean;
}

export module IField {
	export function is (value: unknown): value is IField {
		return !!value
			&& typeof value === "object"
			&& typeof (value as any).name === "string"
			&& typeof (value as any).value === "string"
			&& (typeof (value as any).inline === "boolean" || (value as any).inline === undefined);
	}
}

declare module "discord.js" {
	interface Message {
		// deleted?: true;
		reacting?: Promise<MessageReaction>;
	}

	interface MessageEmbed {
		addFields (...fields: Array<EmbedFieldData[] | EmbedFieldData | undefined | "" | 0 | null>): this;
		setTitle (title?: string): this;
		setDescription (description?: string): this;
		setFooter (footer?: string): this;
		setURL (url?: string): this;
		setThumbnail (url?: string): this;
		setAuthor (name?: string, thumbnail?: string, url?: string): this;
		setColor (color?: ColorResolvable): this;
		setPreferredReactions (...reactions: (string | Emoji)[]): this;
		getPreferredReactions (): (string | Emoji)[];
		inherit (embed: MessageEmbed): this;
		clearFields (): this;
	}

	interface TextChannel {
		isAwaitingMessages (message?: Message): boolean;
		clearAwaitingMessages (): void;
	}

	interface DMChannel {
		isAwaitingMessages (message?: Message): boolean;
		clearAwaitingMessages (): void;
	}

	interface NewsChannel {
		isAwaitingMessages (message?: Message): boolean;
		clearAwaitingMessages (): void;
	}

	interface MessageOptions {
		replyTo?: Message;
		ping?: true;
	}
}

const originalReact = Message.prototype.react;
Message.prototype.react = async function (...args) {
	const promise = originalReact.apply(this, args);
	this.reacting = promise;
	const result = await promise;
	delete this.reacting;
	return result;
};

const originalDelete = Message.prototype.delete;
Message.prototype.delete = async function (...args) {
	if (this.deleted)
		return this;

	await this.reacting;
	this.deleted = true;
	return originalDelete.apply(this, args);
};

const originalSetTitle = MessageEmbed.prototype.setTitle;
MessageEmbed.prototype.setTitle = function (title?: string) {
	if (title)
		return originalSetTitle.call(this, title);

	delete this.title;
	return this;
};

const originalSetDescription = MessageEmbed.prototype.setDescription;
MessageEmbed.prototype.setDescription = function (description?: string) {
	if (description)
		return originalSetDescription.call(this, description);

	delete this.description;
	return this;
};

const originalSetFooter = MessageEmbed.prototype.setFooter;
MessageEmbed.prototype.setFooter = function (footer?: string) {
	if (footer)
		return originalSetFooter.call(this, footer);

	this.footer = null;
	return this;
};

const originalSetURL = MessageEmbed.prototype.setURL;
MessageEmbed.prototype.setURL = function (url?: string) {
	if (url)
		return originalSetURL.call(this, url);

	delete this.url;
	return this;
};

const originalSetThumbnail = MessageEmbed.prototype.setThumbnail;
MessageEmbed.prototype.setThumbnail = function (url?: string) {
	if (url)
		return originalSetThumbnail.call(this, url);

	this.thumbnail = null;
	return this;
};

const originalSetAuthor = MessageEmbed.prototype.setAuthor;
MessageEmbed.prototype.setAuthor = function (name?: string, thumbnail?: string, url?: string) {
	if (name)
		return originalSetAuthor.call(this, name, thumbnail, url);

	this.author = null;
	return this;
};

const originalSetColor = MessageEmbed.prototype.setColor;
MessageEmbed.prototype.setColor = function (color?: ColorResolvable) {
	if (color)
		return originalSetColor.call(this, color);

	delete this.color;
	return this;
};

const originalAddFields = MessageEmbed.prototype.addFields;
MessageEmbed.prototype.addFields = function (...fields: Array<EmbedFieldData[] | EmbedFieldData | undefined | "" | 0 | null>) {
	return originalAddFields.apply(this, fields.filter(field => field));
}

MessageEmbed.prototype.clearFields = function () {
	this.fields?.splice(0, Infinity);
	return this;
}

MessageEmbed.prototype.setPreferredReactions = function (...reactions) {
	(this as any).reactions = reactions;
	return this;
}

MessageEmbed.prototype.getPreferredReactions = function () {
	return (this as any).reactions || [];
}

MessageEmbed.prototype.inherit = function (embed) {
	this.setTitle(embed.title);
	this.setURL(embed.url);
	this.setDescription(embed.description);
	this.setFooter(embed.footer);
	if (embed.color !== undefined)
		this.setColor(embed.color);
	if (embed.timestamp !== null)
		this.setTimestamp(new Date(embed.timestamp));
	this.addFields(...embed.fields || []);

	if (embed.author)
		this.setAuthor(embed.author.name, embed.author.iconURL, embed.author.url);

	if (embed.thumbnail)
		this.setThumbnail(embed.thumbnail.url);

	if (embed.image)
		this.setImage(embed.image.url);

	return this;
};

for (const cls of [TextChannel, DMChannel, NewsChannel]) {
	const channelsAwaitingMessages = new Map<string, CollectorFilter>();

	const originalAwaitMessages = cls.prototype.awaitMessages;
	cls.prototype.awaitMessages = async function (filter, options) {
		channelsAwaitingMessages.set(this.id, filter);
		const result = await originalAwaitMessages.call(this, filter, options);
		channelsAwaitingMessages.delete(this.id);
		return result;
	}

	cls.prototype.isAwaitingMessages = function (message?: Message) {
		return message === undefined ? channelsAwaitingMessages.has(this.id)
			: !!channelsAwaitingMessages.get(this.id)?.(message);
	}

	cls.prototype.clearAwaitingMessages = function () {
		channelsAwaitingMessages.delete(this.id);
	}
}

export module CommandResult {

	export function pass (commandMessage?: CommandMessage, ...output: ArrayOr<Message>[]): CommandResult {
		return apply(commandMessage, { type: "pass", commandMessage, output: output.flat() });
	}

	export function fail (commandMessage: CommandMessage, ...output: ArrayOr<Message>[]): CommandResult {
		return apply(commandMessage, { type: "fail", commandMessage, output: output.flat() });
	}

	export function mid (commandMessage?: CommandMessage, ...output: ArrayOr<Message>[]): CommandResult {
		return apply(commandMessage, { type: "mid", commandMessage, output: output.flat() });
	}

	function apply (commandMessage: CommandMessage | undefined, result: CommandResult) {
		if (commandMessage)
			commandMessage.previous = result;

		return result;
	}
}

export type CommandFunction = (message: CommandMessage, ...args: string[]) => CommandResult | Promise<CommandResult>;
export type CommandRegistrationCondition<P extends ExcludeProperties<Plugin<any, any>, "initData"> = Plugin> = (plugin: P) => boolean;
export type CommandMetadata<P extends ExcludeProperties<Plugin<any, any>, "initData"> = Plugin> = [GetterOr<ArrayOr<string>, [P]>, CommandRegistrationCondition<P>];

export type CommandFunctionDescriptor = TypedPropertyDescriptor<(message: CommandMessage, ...args: string[]) => CommandResult> |
	TypedPropertyDescriptor<(message: CommandMessage, ...args: string[]) => Promise<CommandResult>>;

export const SYMBOL_COMMAND = Symbol("import-plugin");
export function Command<P extends ExcludeProperties<Plugin<any, any>, "initData"> = Plugin> (name: GetterOr<ArrayOr<string>, [P]>, condition?: CommandRegistrationCondition<P>) {
	return Reflect.metadata(SYMBOL_COMMAND, [name, condition]) as
		(target: any, property: string | number | symbol, descriptor: CommandFunctionDescriptor) => any;
}

type ExcludeProperties<T, EXCLUDED_PROPERTIES extends PropertyKey> = { [K in Exclude<keyof T, EXCLUDED_PROPERTIES>]?: T[K] };

export class RoleMatcher {

	private matchers: (string | RegExp | { not: string | RegExp })[];
	private not = false;

	public constructor (config: ArrayOr<string> | { not: ArrayOr<string> }) {
		if (typeof config === "object" && "not" in config)
			this.not = true, config = config.not;

		this.matchers = Arrays.or(config)
			.map(matcher => matcher[0] === "!" ? { not: Regex.parse(matcher.slice(1)) ?? matcher.slice(1) }
				: Regex.parse(matcher) ?? matcher);
	}

	public matchesRoles (roles: Collection<string, Role>) {
		return roles.some(role => this.matches(role)) === !this.not;
	}

	@Bound public matches (role: Role) {
		return this.matchers.some(matcher => {
			let not = false;
			if (typeof matcher === "object" && "not" in matcher)
				not = true, matcher = matcher.not;

			if (typeof matcher === "string")
				return (role.id === matcher || role.name === matcher) === !not;

			return matcher.test(role.name) === !not;
		});
	}
}

const originalResolveData = APIMessage.prototype.resolveData;
Object.defineProperty(APIMessage.prototype, "resolveData", {
	value (this: APIMessage) {
		if (this.data) return this;
		originalResolveData.call(this);
		const options = this.options as MessageOptions;
		if (options.replyTo !== undefined)
			Object.assign(this.data, { message_reference: { message_id: options.replyTo.id } });
		if (!options.ping)
			Object.assign(this.data, { allowed_mentions: { parse: [] } });
		return this;
	}
});
