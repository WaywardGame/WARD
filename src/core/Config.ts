import * as fs from "mz/fs";
import Logger, { ILoggerConfig } from "../util/Log";
import { IExternalPluginConfig, IPluginConfig } from "./Plugin";
import json5 = require("json5");

export interface IConfig {
	logging: ILoggerConfig;
	instances: IGuildConfig[];
}

export interface IGuildConfig {
	commandPrefix: string;
	externalPlugins?: IExternalPluginConfig[];
	plugins: Record<string, false | IPluginConfig>;
	apis: {
		[key: string]: false | object;
		discord: {
			username: string;
			token: string;
			guild: string;
		};
	};
}

export class Config {
	private onGetHandlers: Array<[(cfgs: IConfig) => any, (err: Error) => any]> = [];
	private result: IConfig;
	private isGetting = false;

	public async get (): Promise<IConfig> {
		if (this.result) {
			return this.result;

		} else {
			if (!this.isGetting) {
				this.isGetting = true;
				fs.readFile("config.json5", "utf8").then(text => {
					const result = json5.parse(text) as IConfig;
					this.result = result;
					for (const [handler] of this.onGetHandlers) {
						handler(this.result);
					}

					this.onGetHandlers.splice(0, Infinity);
					this.isGetting = false;
				}).catch(err => {
					// tslint:disable-next-line no-console
					Logger.error("config", "Can't load config file");
					for (const [, errorHandler] of this.onGetHandlers) {
						errorHandler(err);
					}

					this.onGetHandlers.splice(0, Infinity);
				});
			}

			return new Promise<IConfig>((resolve, reject) => {
				this.onGetHandlers.push([resolve, reject]);
			});
		}
	}
}
