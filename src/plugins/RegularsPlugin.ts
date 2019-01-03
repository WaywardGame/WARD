import { Collection, GuildMember, Message, Role } from "discord.js";

import { Plugin } from "../core/Plugin";
import { sleep } from "../util/Async";
import { days, getTime, hours, minutes } from "../util/Time";

const colorRegex = /#[A-F0-9]{6}/;
function parseColorInput (color: string) {
	if (color.startsWith("#")) {
		color = color.slice(1);
	}

	if (color.length === 3) {
		color = `${color[0]}${color[0]}${color[1]}${color[1]}${color[2]}${color[2]}`;
	}

	if (!color.startsWith("#")) {
		color = `#${color}`;
	}

	return color.toUpperCase();
}

export interface ITrackedMember {
	id: string;
	talent: number;
	lastDay: number;
	daysVisited: number;
	maxTalentForMessageBlockStartTime: number;
	maxTalentForMessageBlockMessagesSent: number;
	talentLossForMessageBlockStartTime: number;
	talentLossForMessageBlockMessagesSent: number;
}

export enum RegularsData {
	TrackedMembers,
}

export interface IRegularsConfig {
	excludedChannels?: string[];
	daysBeforeTalentLoss: number;
	talentForNewDay: number;
	talentForMessage: number;
	// 0: maximum talent in 1: amount of time
	maxTalentForMessage: [number, string];
	// 0: amount of talent in 1: amount of time where any additional messages reduce your talent by 2: amount
	talentLossForMessage: [number, string, number];
	daysVisitedMultiplier: number;
	daysVisitedMultiplierReduction: number;
	regularMilestoneTalent: number;
}

export class RegularsPlugin extends Plugin<IRegularsConfig, RegularsData> {
	public updateInterval = hours(12);
	public autosaveInterval = minutes(30);

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
					if (member && !member.roles.has(this.roleMod.id)) {
						member.removeRole(this.roleRegular);
						this.removeColor(member);
					}

					delete this.members[memberId];
				}
			}
		}
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		switch (command) {
			case "talent": return this.commandTalent(message, args[0]);
			case "top": return this.commandTop(message, +args[0], +args[1]);
			case "color": return this.commandColor(message, args[0], args[1]);
			case "talent-add": return this.commandTalentAdd(message, args[0], +args[1]);
			case "days": return this.commandDaysChatted(message, args[0]);
		}
	}

	public onMessage (message: Message) {
		if (
			!message.guild ||
			(this.config.excludedChannels && this.config.excludedChannels.includes(message.channel.id))
		) {
			return;
		}

		this.onMemberMessage(message.member);
	}

	public getTrackedMember (id: string) {
		const today = this.getToday();

		let trackedMember = this.members[id];
		if (!trackedMember) {
			trackedMember = this.members[id] = {
				id,
				talent: 0,
				daysVisited: 0,
				lastDay: today,
				maxTalentForMessageBlockStartTime: Date.now(),
				maxTalentForMessageBlockMessagesSent: 0,
				talentLossForMessageBlockStartTime: Date.now(),
				talentLossForMessageBlockMessagesSent: 0,
			};
		}

		return trackedMember;
	}

	private async removeColor (member: GuildMember) {
		const colorRoles = member.roles.filter(r => colorRegex.test(r.name));
		await member.removeRoles(colorRoles);
		this.removeUnusedColorRoles(colorRoles);
	}

	private onMemberMessage (member: GuildMember) {
		const trackedMember = this.getTrackedMember(member.id);

		let talentChange = this.config.talentForMessage;

		if (trackedMember.maxTalentForMessageBlockStartTime + getTime(this.config.maxTalentForMessage[1]) < Date.now()) {
			trackedMember.maxTalentForMessageBlockStartTime = Date.now();
			trackedMember.maxTalentForMessageBlockMessagesSent = 0;
			this.log(`${member.displayName} has sent their first message for the hour.`);

		} else if (trackedMember.maxTalentForMessageBlockMessagesSent > this.config.maxTalentForMessage[0]) {
			talentChange = 0;
			this.log(`${member.displayName} has earned the maximum talent for the hour.`);
		}

		trackedMember.maxTalentForMessageBlockMessagesSent++;

		if (trackedMember.talentLossForMessageBlockStartTime + getTime(this.config.talentLossForMessage[1]) < Date.now()) {
			trackedMember.talentLossForMessageBlockStartTime = Date.now();
			trackedMember.talentLossForMessageBlockMessagesSent = 0;
			this.log(`${member.displayName} has sent their first message for the 10 minutes.`);

		} else if (trackedMember.talentLossForMessageBlockMessagesSent > this.config.talentLossForMessage[0]) {
			talentChange = -this.config.talentLossForMessage[2];
			this.log(`${member.displayName} is sending too many messages!`);
		}

		trackedMember.talentLossForMessageBlockMessagesSent++;

		this.updateMember(member, talentChange);
	}

	private getToday () {
		return Math.floor(Date.now() / days(1));
	}

	private updateMember (member: GuildMember, score: number) {
		const today = this.getToday();
		const trackedMember = this.getTrackedMember(member.id);

		const multiplier = 1 +
			(trackedMember.daysVisited * this.config.daysVisitedMultiplier) ** this.config.daysVisitedMultiplierReduction;

		if (trackedMember.lastDay < today) {
			trackedMember.daysVisited++;
			trackedMember.lastDay = today;
			trackedMember.talent += Math.floor(this.config.talentForNewDay * multiplier);
		}

		trackedMember.talent += Math.floor(score * multiplier);

		this.checkMemberRegular(member);

		this.updateTopMember(trackedMember);
	}

	private checkMemberRegular (member: GuildMember) {
		const trackedMember = this.getTrackedMember(member.id);

		if (
			trackedMember.talent > this.config.regularMilestoneTalent &&
			!member.roles.has(this.roleRegular.id) && !member.roles.has(this.roleMod.id)
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
	}

	private updateTopMember (trackedMember: ITrackedMember) {
		if (!this.topMembers.some(a => a.id == trackedMember.id)) {
			this.topMembers.push(trackedMember);
		}

		this.topMembers.sort((a, b) => b.talent - a.talent);
		this.topMembers.splice(20, Infinity);
	}

	private updateTopMembers () {
		this.topMembers = Object.values(this.members);
		this.topMembers.sort((a, b) => b.talent - a.talent);
		this.topMembers.splice(20, Infinity);
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
	private async commandTalent (message: Message, queryMember?: string) {
		let member = message.member;

		if (queryMember) {
			const resultingQueryMember = await this.findMember(queryMember);

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

	private commandTop (message: Message, quantity: number, offset: number) {
		quantity = isNaN(+quantity) ? 3 : Math.max(1, Math.min(20, quantity));
		offset = isNaN(+offset) ? 1 : Math.max(1, Math.min(20, offset));

		let response = `
${offset == 1 ? `Top ${quantity}` : `Users with the most talent (quantity: ${quantity}, starting at: ${offset})`}:`;

		for (let i = 0; i < quantity; i++) {
			const member = this.topMembers[offset + i - 1];
			if (member === undefined) {
				break;
			}

			response += `
${offset + i}. ${this.getMemberName(member.id)}: ${member.talent}`;
		}

		this.reply(message, response);
	}

	private async commandColor (message: Message, color?: string, queryMember?: string) {
		let member = message.member;

		if (queryMember) {
			if (!message.member.roles.has(this.roleMod.id)) {
				this.reply(message, "you must be a moderator of the server to change someone else's color.");
				return;
			}

			const resultingQueryMember = await this.findMember(queryMember);

			if (!this.validateFindResult(message, resultingQueryMember)) {
				return;
			}

			member = resultingQueryMember;

		} else {
			if (!this.isUserRegular(message.member)) {
				this.reply(message, "sorry, but you must be a regular of the server to change your color.");
				return;
			}
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

		await this.removeColor(member);

		if (isRemoving) {
			return;
		}

		const colorRole = await this.getColorRole(color);
		await member.addRole(colorRole);
	}

	private async commandTalentAdd (message: Message, queryMember?: string, amt?: number) {
		if (!message.member.roles.has(this.roleMod.id)) {
			this.reply(message, "only mods may manually modify talent of members.");
			return;
		}

		if (queryMember === undefined || !amt) {
			this.reply(message, "you must provide a member to update the talent on and the amount to change the talent by.");
			return;
		}

		const member = await this.findMember(queryMember);
		if (!this.validateFindResult(message, member)) {
			return;
		}

		const trackedMember = this.getTrackedMember(member.id);
		trackedMember.talent += amt;

		const operation = `${amt > 0 ? "added" : "subtracted"} ${Math.abs(amt)} talent ${amt > 0 ? "to" : "from"}`;
		this.reply(message, `I ${operation} ${member.displayName}. Their new talent is ${trackedMember.talent}.`);
		this.log(
			message.member.displayName,
			`${operation} ${member.displayName}. Their new talent is ${trackedMember.talent}.`,
		);

		this.updateTopMember(trackedMember);
	}

	private async commandDaysChatted (message: Message, queryMember?: string) {
		let member = message.member;

		if (queryMember) {
			const resultingQueryMember = await this.findMember(queryMember);

			if (!this.validateFindResult(message, resultingQueryMember)) {
				return;
			}

			member = resultingQueryMember;
		}

		const memberName = member.displayName;

		if (member.user.bot) {
			this.reply(message, member.id == this.user.id ?
				"I have existed longer than time itself." :
				`${memberName} has existed longer than time itself.`,
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

		const daysVisited = this.members[member.id].daysVisited;
		this.reply(message, queryMember ?
			`${memberName} has chatted on ${daysVisited} days.` :
			`you have chatted on ${daysVisited} days.`,
		);
	}
}
