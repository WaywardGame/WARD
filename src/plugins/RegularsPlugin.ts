import { Collection, GuildMember, Message, Role } from "discord.js";

import { Plugin } from "../core/Plugin";
import { sleep } from "../util/Async";
import { days, hours } from "../util/Time";

const colorRegex = /#[A-F0-9]{6}/;
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

export class RegularsPlugin extends Plugin<IRegularsConfig, RegularsData> {
	public updateInterval = hours(12);

	private members: { [key: string]: ITrackedMember };
	private topMembers: ITrackedMember[];
	private roleRegular: Role;
	private roleMod: Role;

	public getDefaultId () {
		return "regulars";
	}

	public async onStart () {
		this.members = await this.data(RegularsData.TrackedMembers, {});
		this.updateTopMembers();

		this.roleRegular = this.guild.roles.find("name", "regular");
		this.roleMod = this.guild.roles.find("name", "mod");

		this.removeUnusedColorRoles();
	}

	public onUpdate () {
		const today = this.getToday();
		for (const memberId in this.members) {
			const trackedMember = this.members[memberId];

			if (trackedMember.lastDay < today - this.config.daysBeforeTalentLoss) {
				trackedMember.talent--;

				if (trackedMember.talent == 0) {
					const member = this.guild.members.find("id", trackedMember.id);
					if (member) {
						member.removeRole(this.roleRegular);
					}

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
			case "talent-add": return this.commandTalentAdd(message, args[0], +args[1]);
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

	private async removeUnusedColorRoles (colorRoles?: Collection<string, Role>) {
		if (colorRoles) {
			await sleep(10000);

		} else {
			colorRoles = this.guild.roles.filter(r => colorRegex.test(r.name));
		}

		for (const role of colorRoles.values()) {
			if (role.members.size === 0) {
				await role.delete();
			}
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

		return member.displayName;
	}

	private isUserRegular (member: GuildMember) {
		return member.roles.has(this.roleRegular.id) ||
			member.highestRole.position >= this.roleMod.position;
	}

	// tslint:disable cyclomatic-complexity
	private commandTalent (message: Message, queryMember?: string) {
		let member = message.member;

		if (queryMember) {
			const resultingQueryMember = this.findMember(queryMember);

			if (!this.validateFindResult(message, resultingQueryMember)) {
				return;
			}

			member = resultingQueryMember;
		}

		const memberName = member.displayName;

		if (member.user.bot) {
			this.reply(message, member.id == this.user.id ?
				"my talent is limitless." :
				`the talent of ${memberName} is limitless.`,
			);

			return;
		}

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

	private async commandColor (message: Message, color?: string) {
		if (this.isUserRegular(message.member)) {
			this.reply(message, "sorry, but you must be a regular of the server to change your color.");

			return;
		}

		if (!color) {
			this.reply(message, "you must provide a valid color. Examples: `f00` is red, `123456` is dark blue.");

			return;
		}

		const isRemoving = /none|reset|remove/.test(color);

		color = parseColorInput(color);
		if (!isRemoving && !colorRegex.test(color)) {
			this.reply(message, "you must provide a valid color. Examples: `f00` is red, `123456` is dark blue.");

			return;
		}

		const colorRoles = message.member.roles.filter(r => colorRegex.test(r.name));
		await message.member.removeRoles(colorRoles);
		this.removeUnusedColorRoles(colorRoles);

		if (isRemoving) {
			return;
		}

		const colorRole = await this.getColorRole(color);
		await message.member.addRole(colorRole);
	}

	private async commandTalentAdd (message: Message, queryMember?: string, amt?: number) {
		if (queryMember === undefined || !amt) {
			this.reply(message, "you must provide a member to update the talent on and the amount to change the talent by.");
			return;
		}

		const member = this.findMember(queryMember);
		if (!this.validateFindResult(message, member)) {
			return;
		}

		let trackedMember = this.members[member.id];
		if (!trackedMember) {
			trackedMember = this.members[member.id] = {
				id: member.id,
				talent: 0,
				daysVisited: 0,
				lastDay: 0,
			};
		}

		trackedMember.talent += amt;

		const operation = `${amt > 0 ? "added" : "subtracted"} ${Math.abs(amt)} talent ${amt > 0 ? "to" : "from"}`;
		this.reply(message, `I ${operation} ${member.displayName}. Their new talent is ${trackedMember.talent}.`);
	}
}
