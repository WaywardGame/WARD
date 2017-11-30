import { Collection, Guild, GuildMember, Message } from "discord.js";
import * as fs from "mz/fs";

import { getTime, never, TimeUnit } from "./util/Time";


const valRegex = /([0-9\.]+) ?([a-z]+)/;
function getUpdateInterval (val: string | [TimeUnit, number]) {
	if (typeof val == "string") {
		const [, number, unit] = val.match(valRegex);
		val = [unit as TimeUnit, +number];
	}

	return getTime(val[0], val[1]);
}

export interface IPluginConfig {
	updateInterval?: string | [TimeUnit, number];
}

export abstract class Plugin<DataIndex extends string | number = string | number, Config extends {} = {}> {
	public updateInterval = never();
	public lastUpdate = 0;
	public guild: Guild;

	private _config: Config & IPluginConfig;
	private pluginData: any = {};
	private loaded = false;
	private id = this.getDefaultId();

	public get config () {
		return this._config;
	}
	public set config (cfg: Config & IPluginConfig) {
		this._config = cfg;

		if (cfg.updateInterval) {
			this.updateInterval = getUpdateInterval(cfg.updateInterval);
		}
	}

	public abstract getDefaultId (): string;

	/* hooks */
	public onUpdate?(): any;
	public onStart?(): any;
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
		if (Object.keys(this.pluginData).length === 0) {
			return;
		}

		await fs.mkdir("data").catch(err => { });

		await fs.writeFile(this.getDataPath(), JSON.stringify(this.pluginData));
	}

	protected setData (key: DataIndex, data: any) {
		this.pluginData[key] = data;
	}
	protected async getData (key: DataIndex): Promise<any> {
		if (!this.loaded) {
			this.loaded = true;
			if (await fs.exists(this.getDataPath())) {
				this.data = JSON.parse(await fs.readFile(this.getDataPath(), "utf8"));
			}
		}

		return this.pluginData[key];
	}
	protected async data (key: DataIndex, defaultValue: any) {
		if (!this.loaded) {
			this.loaded = true;
			if (await fs.exists(this.getDataPath())) {
				this.pluginData = JSON.parse(await fs.readFile(this.getDataPath(), "utf8"));
			}
		}

		if (this.pluginData[key] === undefined) {
			this.pluginData[key] = defaultValue;
		}

		return this.pluginData[key];
	}

	protected log (...args: any[]) {
		// tslint:disable-next-line no-console
		console.log(`[${this.getId()}]`, ...args);
	}

	protected reply (message: Message, reply: string) {
		if (!message.guild) {
			reply = reply[0].toUpperCase() + reply.slice(1);
		}

		message.reply(reply);
	}

	/**
	 * @param member Can be an ID, a tag, part of a display name, or part of a username
	 * @returns undefined if no members match, the matching Collection of members if multiple members match,
	 * and the matching member if one member matches
	 */
	protected findMember (member: string): GuildMember | Collection<string, GuildMember> | undefined {
		member = member.toLowerCase();
		const results = this.guild.members.filter(m =>
			m.displayName.toLowerCase().includes(member) ||
			m.id == member ||
			m.user.tag == member,
		);

		switch (results.size) {
			case 0: return undefined;
			case 1: return results.first();
			default: return results;
		}
	}

	private getDataPath () {
		return `data/${this.getId()}.json`;
	}
}
