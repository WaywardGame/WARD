import * as fs from "mz/fs";

export interface IConfig {
	commandPrefix: string;
	plugins: {
		[key: string]: any;
	};
	apis: {
		[key: string]: any;
		discord: {
			username: string;
			token: string;
			guild: string;
		};
	};
}

export class Config {
	private onGetHandlers: Array<[(cfg: IConfig) => any, (err: Error) => any]> = [];
	private result: any;
	private isGetting = false;

	public async get (): Promise<IConfig> {
		if (this.result) {
			return this.result;

		} else {
			if (!this.isGetting) {
				this.isGetting = true;
				fs.readFile("config.json", "utf8").then(text => {
					const result = JSON.parse(text);
					this.result = result;
					for (const onGetHandler of this.onGetHandlers) {
						onGetHandler[0](this.result);
					}

					delete this.onGetHandlers;
					this.isGetting = false;
				}).catch(err => {
					// tslint:disable-next-line no-console
					console.log("Can't load config file");
					for (const onGetHandler of this.onGetHandlers) {
						onGetHandler[1](err);
					}

					delete this.onGetHandlers;
				});
			}

			return new Promise<IConfig>((resolve, reject) => {
				this.onGetHandlers.push([resolve, reject]);
			});
		}
	}
}
