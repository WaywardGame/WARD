import { Guild, Message } from "discord.js";
import * as fs from "mz/fs";

import { never } from "./util/Time";

export abstract class Plugin<DataIndex extends string | number = string | number> {
	public updateInterval = never();
	public lastUpdate = 0;
	private data: any = {};
	private loaded = false;
	private id = this.getDefaultId();

	public abstract getDefaultId (): string;

	/* hooks */
	public onUpdate?(): any;
	public onStart?(guild: Guild): any;
	public onStop?(): any;
	public onMessage?(message: Message): any;
	public onCommand?(message: Message, command: string, ...args: string[]): any;

	public getId () {
		return this.id;
	}
	public setId (pid: string) {
		this.id = pid;
	}

	public async save () {
		await fs.mkdir("data").catch(err => { });

		await fs.writeFile(this.getDataPath(), JSON.stringify(this.data));
	}

	protected async setData (key: DataIndex, data: any) {
		this.data[key] = data;
	}
	protected async getData (key: DataIndex): Promise<any> {
		if (!this.loaded) {
			this.loaded = true;
			if (await fs.exists(this.getDataPath())) {
				this.data = JSON.parse(await fs.readFile(this.getDataPath(), "utf8"));
			}
		}

		return this.data[key];
	}

	protected log (...args: any[]) {
		// tslint:disable-next-line no-console
		console.log(`[${this.getId()}]`, ...args);
	}

	private getDataPath () {
		return `data/${this.getId()}.json`;
	}
}
