import { Guild, GuildMember, Message, Role } from "discord.js";

import { Plugin } from "../Plugin";
import { days, hours } from "../util/Time";

function parseColorInput (color: string) {
	if (color.length === 3) {
		color = `${color[0]}${color[0]}${color[1]}${color[1]}${color[2]}${color[2]}`;
	}

	if (!color.startsWith("#")) {
		color = `#${color}`;
	}

	return color.toUpperCase();
}

interface ITrackedMember {
	id: string;
	talent: number;
	lastDay: number;
	daysVisited: number;
}

export enum RegularsData {
	TrackedMembers,
}

export interface IRegularsConfig {
	excludedChannels?: string[];
	daysBeforeTalentLoss: number;
	talentForNewDay: number;
	talentForMessage: number;
	daysVisitedMultiplier: number;
	regularMilestoneTalent: number;
}

export class RegularsPlugin extends Plugin<RegularsData, IRegularsConfig> {
	public updateInterval = hours(12);

	private members: { [key: string]: ITrackedMember };
	private topMembers: ITrackedMember[];
	private roleRegular: Role;
	private roleMod: Role;
	private guild: Guild;

	public getDefaultId () {
		return "regulars";
	}

	public async onStart (guild: Guild) {
		this.guild = guild;

		this.members = await this.data(RegularsData.TrackedMembers, {});
		this.updateTopMembers();

		this.roleRegular = this.guild.roles.find("name", "regular");
		this.roleMod = this.guild.roles.find("name", "mod");
	}

	public onUpdate () {
		const today = this.getToday();
		for (const memberId in this.members) {
			const trackedMember = this.members[memberId];

			if (trackedMember.lastDay < today - this.config.daysBeforeTalentLoss) {
				trackedMember.talent--;

				if (trackedMember.talent == 0) {
					const member = this.guild.members.find("id", trackedMember.id);
					member.removeRole(this.roleRegular);
					delete this.members[memberId];
				}
			}
		}
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		switch (command) {
			case "talent": return this.commandTalent(message, args[0]);
			case "top": return this.commandTop(message);
			case "color": return this.commandColor(message, args[0]);
		}
	}

	public onMessage (message: Message) {
		if (this.config.excludedChannels && this.config.excludedChannels.includes(message.channel.id)) {
			return;
		}

		this.updateMember(message.member, this.config.talentForMessage);
	}

	private getToday () {
		return Math.floor(Date.now() / days(1));
	}

	private updateMember (member: GuildMember, score: number) {
		const today = this.getToday();

		let trackedMember = this.members[member.id];
		if (!trackedMember) {
			trackedMember = this.members[member.id] = {
				id: member.id,
				talent: 0,
				daysVisited: 0,
				lastDay: today,
			};
		}

		const multiplier = 1 + trackedMember.daysVisited * this.config.daysVisitedMultiplier;

		if (trackedMember.lastDay < today) {
			trackedMember.daysVisited++;
			trackedMember.lastDay = today;
			trackedMember.talent += Math.floor(this.config.talentForNewDay * multiplier);
		}

		trackedMember.talent += Math.floor(score * multiplier);
		if (
			trackedMember.talent > this.config.regularMilestoneTalent &&
			member.highestRole.position < this.roleRegular.position
		) {
			member.addRole(this.roleRegular);
			this.log(`${this.getMemberName(member)} has become a regular!`);
			member.user.send(`
Hey ${this.getMemberName(member)}! You have become a regular on ${this.guild.name}.

As a regular, you may now change your username color whenever you please, using the !color command.
Examples: \`!color f00\` would make your username bright red, \`!color 123456\` would make you a dark blue.
Like any other of my commands, you may use it in the Wayward server or in a PM with me.

I will not send any other notification messages, apologies for the interruption.
			`);
		}

		this.updateTopMember(trackedMember);
	}

	private updateTopMember (trackedMember: ITrackedMember) {
		if (!this.topMembers.some(a => a.id == trackedMember.id)) {
			this.topMembers.push(trackedMember);
		}

		this.topMembers.sort((a, b) => b.talent - a.talent);
		this.topMembers.splice(3, Infinity);
	}

	private updateTopMembers () {
		this.topMembers = Object.values(this.members);
		this.topMembers.sort((a, b) => b.talent - a.talent);
		this.topMembers.splice(3, Infinity);
	}

	private async commandColor (message: Message, color: string) {
		if (message.member.highestRole.position < this.roleRegular.position) {
			this.reply(message, "sorry, but you must be a regular of the server to change your color.");

			return;
		}

		const colorRegex = /#[A-F0-9]{6}/;
		const colorRoles = message.member.roles.filter(r => colorRegex.test(r.name));
		await message.member.removeRoles(colorRoles);
		for (const role of colorRoles.values()) {
			if (role.members.size === 0) {
				await role.delete();
			}
		}

		if (!/none|reset|remove/.test(color)) {
			color = parseColorInput(color);
			const colorRole = await this.getColorRole(color);
			await message.member.addRole(colorRole);
		}
	}

	private async getColorRole (color: string) {
		let colorRole = this.guild.roles.find("name", color);
		if (!colorRole) {
			colorRole = await this.guild.createRole({
				name: color,
				color,
				position: this.roleMod.position + 1,
			});
		}

		return colorRole;
	}

	private getMemberName (memberOrId: string | GuildMember) {
		const member = typeof memberOrId == "string" ? this.guild.members.find("id", memberOrId) : memberOrId;
		if (!member) {
			return "Unknown";
		}

		return member.nickname || member.user.username;
	}

	// tslint:disable cyclomatic-complexity
	private commandTalent (message: Message, queryMember?: string) {
		let member = message.member;

		if (queryMember) {
			member = this.guild.members.find("nickname", queryMember) ||
				this.guild.members.find(m => m.user.username.toLowerCase() == queryMember.toLowerCase());

			if (!member) {
				this.reply(message, "I couldn't find a member by that name.");

				return;
			}
		}

		const memberName = member.nickname || member.user.username;

		const trackedMember = this.members[member.id];
		if (!trackedMember) {
			this.reply(message, queryMember ?
				`${memberName} has not gained talent yet.` :
				"you have not gained talent yet.",
			);

			return;
		}

		const talent = this.members[member.id].talent;
		this.reply(message, queryMember ?
			`the talent of ${memberName} is ${talent}.` :
			`your talent is ${talent}.`,
		);
	}

	private commandTop (message: Message) {
		this.reply(message, `
The members with the most talent are:
1. ${this.getMemberName(this.topMembers[0].id)}: ${this.topMembers[0].talent}
2. ${this.getMemberName(this.topMembers[1].id)}: ${this.topMembers[1].talent}
3. ${this.getMemberName(this.topMembers[2].id)}: ${this.topMembers[2].talent}
		`);
	}
}
