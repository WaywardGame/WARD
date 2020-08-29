import { Message } from "discord.js";
import { Importable } from "./Importable";
import { Plugin } from "./Plugin";

export abstract class Api<Config = {}> extends Importable<Config> {
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
};

export type CommandFunction = (message: CommandMessage, ...args: string[]) => boolean | Promise<boolean>;
export type CommandRegistrationCondition<P extends Plugin = Plugin> = (plugin: P) => boolean;
export type CommandMetadata<P extends Plugin = Plugin> = [GetterOr<ArrayOr<string>, [P]>, CommandRegistrationCondition<P>];

export type CommandFunctionDescriptor = TypedPropertyDescriptor<(message: CommandMessage, ...args: string[]) => boolean> |
	TypedPropertyDescriptor<(message: CommandMessage, ...args: string[]) => Promise<boolean>>;

export const SYMBOL_COMMAND = Symbol("import-plugin");
export function Command<P extends Plugin = Plugin> (name: GetterOr<ArrayOr<string>, [P]>, condition?: CommandRegistrationCondition<P>) {
	return Reflect.metadata(SYMBOL_COMMAND, [name, condition]) as
		(target: any, property: string | number | symbol, descriptor: CommandFunctionDescriptor) => any;
}
