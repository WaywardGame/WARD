import { Collection, Guild, GuildMember, Message, RichEmbed, User } from "discord.js";
import { EventEmitterAsync } from "../util/Async";
import Logger from "../util/Log";
import { getTime, hours, never, TimeUnit } from "../util/Time";
import { Importable } from "./Importable";


export interface IPluginConfig {
	updateInterval?: string | [TimeUnit, number];
	// autosaveInterval?: string | [TimeUnit, number];
}

export interface IExternalPluginConfig extends IPluginConfig {
	classFile: string;
}

export interface IGetApi<T> {
	(name: string): T;
}

export abstract class Plugin<CONFIG extends {} = any, DATA = {}>
	extends Importable<CONFIG & IPluginConfig> {

	public event = new EventEmitterAsync();

	public updateInterval = never();
	public lastUpdate = 0;
	public autosaveInterval = hours(2);
	public lastAutosave = 0;

	public guild: Guild;
	public user: User;
	public logger: Logger;

	private pluginData: Partial<DATA> & { _lastUpdate?: number } = {};
	// @ts-ignore
	private loaded = false;
	private dirty = false;
	public get isDirty () { return this.dirty; }


	public set config (cfg: CONFIG & IPluginConfig) {
		super.config = cfg;

		if (cfg && cfg.updateInterval) {
			this.updateInterval = getTime(cfg.updateInterval);
		}

		// if (cfg && cfg.autosaveInterval) {
		// 	this.autosaveInterval = getTime(cfg.autosaveInterval);
		// }
	}

	public getDefaultConfig (): CONFIG & IPluginConfig {
		this.logger.warning("No default config");
		return {} as any;
	}

	/* hooks */
	public onUpdate?(): any;
	public onStart?(): any;
	public onStop?(): any;
	public onMessage?(message: Message): any;

	public async save () {
		await this.event.emit("save");
		this.dirty = false;
	}

	public setData<K extends keyof DATA> (key: K, data: DATA[K]) {
		this.pluginData[key] = data;
		this.dirty = true;
	}
	public getData<K extends keyof DATA> (key: K, defaultValue: DATA[K]) {
		if (this.pluginData[key] === undefined) {
			this.pluginData[key] = defaultValue;
			this.dirty = true;
		}

		return this.pluginData[key];
	}

	public reply (message: Message, reply: string | RichEmbed) {
		if (typeof reply === "string") {
			reply = reply.trim();
			if (!message.guild) {
				reply = reply[0].toUpperCase() + reply.slice(1);
			}
			return message.reply(reply);
		} else {
			return message.channel.send({ embed: reply });
		}
	}

	/**
	 * @param member Can be an ID, a tag, part of a display name, or part of a username
	 * @returns undefined if no members match, the matching Collection of members if multiple members match,
	 * and the matching member if one member matches
	 */
	protected async findMember (member: string): Promise<GuildMember | Collection<string, GuildMember> | undefined> {
		member = member.toLowerCase();
		let tag: string;

		const splitMatch = member.match(/^(.*)(#\d{4})$/);
		if (splitMatch)
			[, member, tag] = splitMatch;

		const guild = await this.guild.fetchMembers();
		let results = guild.members.filter(m => m.id === member);
		if (!results.size)
			results = guild.members.filter(m => m.user.username.toLowerCase().includes(member));

		if (!results.size)
			results = guild.members.filter(m => m.displayName.toLowerCase().includes(member));

		if (tag)
			results = results.filter(m => m.user.tag.endsWith(tag));

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
}
