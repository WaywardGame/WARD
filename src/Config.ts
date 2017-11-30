import * as fs from "mz/fs";

export interface IConfig {
	discord: {
		username: string;
		token: string;
		guild: string;
	};
	trello: {
		board: string;
		key: string;
	};
	ward: {
		commandPrefix: string;
		plugins: {
			[key: string]: any;
		};
	};
}

export class Config {
	private onGetHandlers: Array<(cfg: IConfig) => any> = [];
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
						onGetHandler(this.result);
					}

					delete this.onGetHandlers;
					this.isGetting = false;
				}).catch(err => {
					// tslint:disable-next-line no-console
					console.log("Can't load config file");
				});
			}

			return new Promise<IConfig>(resolve => {
				this.onGetHandlers.push(resolve);
			});
		}
	}
}

const config = new Config();
export default config;
