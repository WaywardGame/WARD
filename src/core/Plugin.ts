import { Collection, Guild, GuildMember, Message, User } from "discord.js";
import * as fs from "mz/fs";

import { Logger } from "../util/Log";
import { getTime, never, TimeUnit, hours } from "../util/Time";
import { Importable } from "./Importable";


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
	autosaveInterval?: string | [TimeUnit, number];
}

export interface IGetApi<T> {
	(name: string): T;
}

export abstract class Plugin<Config extends {} = {}, DataIndex extends string | number = string | number>
	extends Importable<Config & IPluginConfig> {

	public updateInterval = never();
	public lastUpdate = 0;
	public autosaveInterval = hours(2);
	public lastAutosave = 0;

	public guild: Guild;
	public user: User;

	private pluginData: any = {};
	private loaded = false;

	public set config (cfg: Config & IPluginConfig) {
		super.config = cfg;

		if (cfg.updateInterval) {
			this.updateInterval = getUpdateInterval(cfg.updateInterval);
		}

		if (cfg.autosaveInterval) {
			this.autosaveInterval = getUpdateInterval(cfg.autosaveInterval);
		}
	}

	/* hooks */
	public onUpdate?(): any;
	public onStart?(): any;
	public onStop?(): any;
	public onMessage?(message: Message): any;
	public onCommand?(message: Message, command: string, ...args: string[]): any;

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
		Logger.log(this.getId(), ...args);
	}

	protected reply (message: Message, reply: string) {
		reply = reply.trim();
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

	protected validateFindResult (
		message: Message,
		result: GuildMember | Collection<string, GuildMember> | undefined,
	): result is GuildMember {
		if (result instanceof Collection) {
			this.reply(message, "I found multiple members with that name. Can you be more specific?");
			return false;

		} else if (!result) {
			this.reply(message, "I couldn't find a member by that name.");
			return false;
		}

		return true;
	}

	private getDataPath () {
		return `data/${this.getId()}.json`;
	}
}
