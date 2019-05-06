import * as fs from "mz/fs";
import { Logger } from "../util/Log";
import { IPluginConfig } from "./Plugin";

export interface IConfig {
	commandPrefix: string;
	plugins: {
		[key: string]: false | IPluginConfig;
	};
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
	private onGetHandlers: Array<[(cfgs: IConfig[]) => any, (err: Error) => any]> = [];
	private result: IConfig[];
	private isGetting = false;

	public async get (): Promise<IConfig[]> {
		if (this.result) {
			return this.result;

		} else {
			if (!this.isGetting) {
				this.isGetting = true;
				fs.readFile("config.json", "utf8").then(text => {
					const result = JSON.parse(text) as IConfig[];
					this.result = result;
					for (const [handler] of this.onGetHandlers) {
						handler(this.result);
					}

					delete this.onGetHandlers;
					this.isGetting = false;
				}).catch(err => {
					// tslint:disable-next-line no-console
					Logger.log("config", "Can't load config file");
					for (const [, errorHandler] of this.onGetHandlers) {
						errorHandler(err);
					}

					delete this.onGetHandlers;
				});
			}

			return new Promise<IConfig[]>((resolve, reject) => {
				this.onGetHandlers.push([resolve, reject]);
			});
		}
	}
}
