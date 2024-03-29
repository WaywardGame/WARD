import * as chalk from "chalk";
import * as fs from "mz/fs";
import { IConfig } from "../core/Config";
import Arrays from "./Arrays";
import stripAnsi = require("strip-ansi");

enum LogLevel {
	error,
	warning,
	info,
	verbose,
}

export interface ILoggerConfig {
	console: keyof typeof LogLevel;
	file: keyof typeof LogLevel | false;
}

const levelColors = {
	[LogLevel.error]: "red" as const,
	[LogLevel.warning]: "yellowBright" as const,
	[LogLevel.info]: "cyan" as const,
	[LogLevel.verbose]: "grey" as const,
};

// @ts-expect-error
let x: Record<LogLevel, keyof chalk.Chalk>;
// test whether using valid colours
x = levelColors;

const scopeColors
	// : readonly (keyof Chalk)[]
	= [
		"white",
		"cyan",
	] as const;

// @ts-expect-error
let y: readonly (keyof Chalk)[];
// test whether using valid colours
y = scopeColors;

export default class Logger {
	private static readonly waitToLog: string[] = [];
	public static readonly sendToChiriLog: string[] = [];
	private static isReadyToLog = false;
	private static config: IConfig["logging"] = {
		console: "verbose",
		file: "verbose",
	};

	public static init (config: IConfig["logging"]) {
		this.config = config;
		if (!config.file)
			return;

		fs.mkdir("logs")
			.finally(() => {
				this.waitToLog.unshift("\n")
				Logger.isReadyToLog = true;
			})
			.catch(err => {
				if (err.code !== "EEXIST")
					throw err;
			});
	}

	public static async verbose (from?: string | string[], ...what: any[]) {
		Logger.logInternal(LogLevel.verbose, from, what);
	}
	public static async info (from?: string | string[], ...what: any[]) {
		Logger.logInternal(LogLevel.info, from, what);
	}
	public static async warning (from?: string | string[], ...what: any[]) {
		Logger.logInternal(LogLevel.warning, from, what);
	}
	public static async error (from?: string | string[], ...what: any[]) {
		Logger.logInternal(LogLevel.error, from, what);
	}

	private static async logInternal (level: LogLevel, from?: ArrayOr<GetterOr<string>>, what: any[] = []) {
		from = Arrays.or(from ?? [])
			.map((scope, i) => chalk[scopeColors[i]](typeof scope === "function" ? scope() : scope)).join(" / ");

		const toLog = [];

		const colorizer = chalk[levelColors[level]];
		toLog.push(colorizer(new Date().toLocaleTimeString()))

		if (what.length === 0)
			toLog.push(from);

		else if (from)
			toLog.push(chalk.grey(`- ${from} -`));

		if (level === LogLevel.verbose)
			what = what.map(value => typeof value === "string" ? colorizer(value) : value);

		if (toLog.some(thing => thing.includes("object")))
			toLog.push(new Error().stack);

		toLog.push(...what
			.map(thing => typeof thing === "object" ? thing instanceof Error ? (thing.stack ?? thing.message) : `${thing}` === "[object Object]" ? JSON.stringify(thing) : `${thing}` : `${thing}`));

		if (level <= LogLevel[this.config.console])
			// tslint:disable-next-line no-console
			console.log(...toLog);

		if (level <= LogLevel.error)
			Logger.sendToChiriLog.push(stripAnsi(toLog.join(" ")));

		if (this.config.file) {
			if (level <= LogLevel[this.config.file])
				Logger.waitToLog.push(stripAnsi(toLog.join(" ")));

			if (Logger.isReadyToLog && this.config.file) {
				const toLog = Logger.waitToLog.slice();
				Logger.waitToLog.length = 0;
				Logger.isReadyToLog = false;

				for (const message of toLog)
					await fs.appendFile("logs/ward.log", `${message}\n`);

				Logger.isReadyToLog = true;
			}
		}
	}

	private readonly _scopes: GetterOr<string>[] = [];

	public get scopes () {
		return this._scopes as readonly GetterOr<string>[];
	}

	public constructor (...scopes: GetterOr<string>[]) {
		this.pushScope(...scopes);
	}

	public pushScope (...scopes: GetterOr<string>[]) {
		this._scopes.push(...scopes);
		return this;
	}

	public popScope () {
		this._scopes.pop();
		return this;
	}

	public popScopes (...scopes: GetterOr<string>[]) {
		while (true) {
			const scope = scopes.pop();
			if (scope === undefined || this._scopes.last() !== scope)
				break;

			this._scopes.pop();
		}
		return this;
	}

	public async verbose (...what: any[]) {
		Logger.logInternal(LogLevel.verbose, this._scopes, what);
	}
	public async info (...what: any[]) {
		Logger.logInternal(LogLevel.info, this._scopes, what);
	}
	public async warning (...what: any[]) {
		Logger.logInternal(LogLevel.warning, this._scopes, what);
	}
	public async error (...what: any[]) {
		Logger.logInternal(LogLevel.error, this._scopes, what);
	}
}
