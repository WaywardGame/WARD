import * as fs from "mz/fs";

export interface IConfig {
	discord: {
		username: string;
		token: string;
	};
	trello: {
		board: string;
		key: string;
	};
}

export class Config {
	private onGetHandlers: Array<(cfg: any) => any> = [];
	private result: any;
	private isGetting = false;

	public async get () {
		if (this.result) {
			return this.result;
		} else {
			if (!this.isGetting) {
				this.isGetting = true;
				fs.readFile("config.json", "utf8").then((text) => {
					const result = JSON.parse(text);
					this.result = result;
					for (const onGetHandler of this.onGetHandlers) {
						onGetHandler(this.result);
					}
					delete this.onGetHandlers;
					this.isGetting = false;
				}).catch((err) => {
					console.log("Can't load config file");
				});
			}
			return new Promise((resolve) => {
				this.onGetHandlers.push(resolve);
			});
		}
	}
}

const config = new Config();
export default config;
