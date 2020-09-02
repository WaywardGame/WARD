import { Message, RichEmbed } from "discord.js";
import { Importable } from "./Importable";
import { Plugin } from "./Plugin";

export abstract class Api<Config = {}> extends Importable<Config> {
	private _config: Config;
	public get config () { return this._config; }
	public set config (cfg: Config) { this._config = cfg; }
}

export const SYMBOL_IMPORT_API_KEY = Symbol("import-api");
export function ImportApi (toImport: string) {
	return Reflect.metadata(SYMBOL_IMPORT_API_KEY, toImport);
}

export const SYMBOL_IMPORT_PLUGIN_KEY = Symbol("import-plugin");
export function ImportPlugin (toImport: string) {
	return Reflect.metadata(SYMBOL_IMPORT_PLUGIN_KEY, toImport);
}

export type CommandMessage = Message & {
	command: string;
	args: string[];
	previous?: CommandResult;
};

export interface CommandResult {
	type: "pass" | "fail";
	commandMessage?: CommandMessage;
	output: Message[];
}

export interface IField {
	name: string;
	content: string;
	inline: boolean;
}

export module IField {
	export function is (value: unknown): value is IField {
		return !!value
			&& typeof value === "object"
			&& typeof (value as any).name === "string"
			&& typeof (value as any).content === "string"
			&& typeof (value as any).inline === "boolean";
	}
}

declare module "discord.js" {
	interface Message {
		deleted?: true;
		reacting?: Promise<MessageReaction>;
	}

	interface RichEmbed {
		addFields (...fields: IField[]): this;
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
	await this.reacting;
	this.deleted = true;
	return await originalDelete.apply(this, args);
};

const originalSetTitle = RichEmbed.prototype.setTitle;
RichEmbed.prototype.setTitle = function (title) {
	return title ? originalSetTitle.call(this, title) : this;
};

RichEmbed.prototype.addFields = function (...fields) {
	for (const field of fields)
		this.addField(field.name, field.content, field.inline);

	return this;
}

export module CommandResult {

	export function pass (commandMessage?: CommandMessage, ...output: ArrayOr<Message>[]): CommandResult {
		return { type: "pass", commandMessage, output: output.flat() };
	}

	export function fail (commandMessage: CommandMessage, ...output: ArrayOr<Message>[]): CommandResult {
		return { type: "fail", commandMessage, output: output.flat() };
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
