import * as fs from "mz/fs";

import { minutes } from "./util/Time";

export abstract class Plugin {
	public updateInterval = minutes(5);
	public lastUpdate = 0;
	private data: any = {};
	private loaded = false;

	public abstract update (): any;
	public abstract getId (): string;
	public abstract setId (pid: string): void;

	public async save () {
		await fs.mkdir("data").catch((err) => { });

		await fs.writeFile(this.getDataPath(), JSON.stringify(this.data));
	}

	protected async setData (key: string, data: any) {
		this.data[key] = data;
	}
	protected async getData (key: string): Promise<any> {
		if (!this.loaded) {
			this.loaded = true;
			if (await fs.exists(this.getDataPath())) {
				this.data = JSON.parse(await fs.readFile(this.getDataPath(), "utf8"));
			}
		}

		return this.data[key];
	}

	protected log (...args: any[]) {
		console.log(`[${this.getId()}]`, ...args);
	}

	private getDataPath () {
		return `data/${this.getId()}.json`;
	}
}
