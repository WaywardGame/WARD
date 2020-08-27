import { Collection, Guild, GuildMember, Message, RichEmbed, Role, TextChannel, User } from "discord.js";
import { EventEmitterAsync, sleep } from "../util/Async";
import Logger from "../util/Log";
import { getTime, hours, never, seconds, TimeUnit } from "../util/Time";
import { Importable } from "./Importable";

enum Pronouns {
	"she/her",
	"he/him",
	"they/them",
	"it/its",
}

const pronounLanguage: Record<keyof typeof Pronouns, { they: string, are: string, them: string, their: string, theirs: string }> = {
	"she/her": { they: "she", are: "is", them: "her", their: "her", theirs: "her" },
	"he/him": { they: "he", are: "is", them: "him", their: "his", theirs: "his" },
	"it/its": { they: "it", are: "is", them: "it", their: "its", theirs: "its" },
	"they/them": { they: "they", are: "are", them: "them", their: "their", theirs: "theirs" },
};


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
	private pronounRoles?: Record<keyof typeof Pronouns, Role | undefined>;
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

		return this.pluginData[key]!;
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
		let tag: string | undefined;

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
			results = results.filter(m => m.user.tag.endsWith(tag!));

		switch (results.size) {
			case 0: return undefined;
			case 1: return results.first();
			default: return results;
		}
	}

	protected async getPronouns (member: GuildMember): Promise<(typeof pronounLanguage)[keyof typeof Pronouns]> {
		if (!this.pronounRoles) {
			this.pronounRoles = {
				"she/her": await this.findRole("she/her"),
				"he/him": await this.findRole("he/him", false),
				"they/them": await this.findRole("they/them", false),
				"it/its": await this.findRole("it/its", false),
			};
		}

		// const pronouns: (keyof typeof Pronouns)[] = [
		// 	this.pronounRoles["she/her"]?.id && member.roles.has(this.pronounRoles["she/her"]?.id) && "she/her" as const,
		// 	this.pronounRoles["he/him"]?.id && member.roles.has(this.pronounRoles["he/him"]?.id) && "he/him" as const,
		// 	this.pronounRoles["it/its"]?.id && member.roles.has(this.pronounRoles["it/its"]?.id) && "it/its" as const,
		// 	this.pronounRoles["they/them"]?.id && member.roles.has(this.pronounRoles["they/them"]?.id) && "they/them" as const,
		// ].filterFalsey(true);

		const pronouns: Record<keyof typeof Pronouns, boolean | "" | undefined> = {
			"she/her": this.pronounRoles["she/her"]?.id && member.roles.has(this.pronounRoles["she/her"]?.id),
			"he/him": this.pronounRoles["he/him"]?.id && member.roles.has(this.pronounRoles["he/him"]?.id),
			"they/them": this.pronounRoles["they/them"]?.id && member.roles.has(this.pronounRoles["they/them"]?.id),
			"it/its": this.pronounRoles["it/its"]?.id && member.roles.has(this.pronounRoles["it/its"]?.id),
		};

		const count = +Boolean(pronouns["she/her"]) + +Boolean(pronouns["he/him"]) + +Boolean(pronouns["it/its"]);
		if (!count || (count > 1 && pronouns["they/them"]))
			return pronounLanguage["they/them"];

		return pronounLanguage[pronouns["she/her"] ? "she/her"
			: pronouns["he/him"] ? "he/him"
				: pronouns["it/its"] ? "it/its"
					: "they/them"];
	}

	/**
	 * @param role A role ID or name
	 * @returns undefined if no members match, the matching Collection of members if multiple members match,
	 * and the matching member if one member matches
	 */
	protected async findRole (role: string, fetch = true): Promise<Role | undefined> {
		const guild = fetch ? await this.guild.fetchMembers() : this.guild;

		return guild.roles.find(r => r.id === role)
			?? guild.roles.find(r => r.name === role)
			?? guild.roles.find(r => r.name.toLowerCase() === role.toLowerCase());
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

	protected async sendAll (channelOrReplyMessage: TextChannel | Message, ...lines: string[]) {
		// lines = lines.map(line => line.split("\n")).flat();
		const messages: string[] = [""];
		for (let line of lines) {
			line = `${line}\n`;
			if (messages.last()!.length + line.length >= 2000)
				messages.push("");

			messages[messages.length - 1] += line;
		}

		const channel = channelOrReplyMessage instanceof Message ? channelOrReplyMessage.channel : channelOrReplyMessage;
		for (const message of messages) {
			channel.send(message);
			await sleep(seconds(1));
		}
	}

	protected async getReactors (message: Message): Promise<Set<User>>;
	protected async getReactors (message: string, channel: TextChannel): Promise<Set<User>>;
	protected async getReactors (message: Message | string, channel?: TextChannel) {
		message = message instanceof Message ? message : await channel!.fetchMessage(message);

		const users = new Set<User>();
		for (const reaction of message.reactions.values())
			for (const user of (await reaction.fetchUsers()).values())
				users.add(user);

		return users;
	}
}
