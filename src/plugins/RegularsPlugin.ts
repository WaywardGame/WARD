import { GuildMember, Message, Role } from "discord.js";
import { Plugin } from "../core/Plugin";
import { days, getTime, hours, minutes } from "../util/Time";
import { Command } from "../core/Api";

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
	commands?: boolean;
}

export class RegularsPlugin extends Plugin<IRegularsConfig, RegularsData> {
	public updateInterval = hours(12);
	public autosaveInterval = minutes(30);

	private members: { [key: string]: ITrackedMember };
	private topMembers: ITrackedMember[];
	private roleRegular: Role;
	private roleMod: Role;
	private readonly onRemoveMemberHandlers: ((member: GuildMember) => any)[] = [];

	public getDefaultId () {
		return "regulars";
	}

	public async onStart () {
		this.members = await this.data(RegularsData.TrackedMembers, {});
		this.updateTopMembers();

		this.roleRegular = this.guild.roles.find(role => role.name === "regular");
		this.roleMod = this.guild.roles.find(role => role.name === "mod");
	}

	public onUpdate () {
		const today = this.getToday();
		for (const memberId in this.members) {
			const trackedMember = this.members[memberId];

			if (trackedMember.lastDay < today - this.config.daysBeforeTalentLoss) {
				trackedMember.talent--;
			}

			if (trackedMember.talent == 0) {
				this.dropTrackedMember(trackedMember);
			}
		}

		for (const [, member] of this.guild.members.filter(member => member.roles.has(this.roleRegular.id))) {
			if (!this.getTrackedMember(member.id, false)) {
				this.removeRegularFromMember(member);
			}
		}
	}

	private dropTrackedMember (trackedMember: ITrackedMember) {
		const member = this.guild.members.find(member => member.id === trackedMember.id);
		this.removeRegularFromMember(member);

		delete this.members[trackedMember.id];
		this.log(`Dropped tracked member '${this.getMemberName(member)}'`);
	}

	private removeRegularFromMember (member: GuildMember) {
		if (member && !member.roles.has(this.roleMod.id) && !member.permissions.has("ADMINISTRATOR")) {
			member.removeRole(this.roleRegular);
			this.onRemoveMemberHandlers.forEach(handler => handler(member));
			this.log(`Removed regular from member '${this.getMemberName(member)}'`);
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

	public getTrackedMember (id: string, create = true) {
		const today = this.getToday();

		let trackedMember = this.members[id];
		if (!create) return trackedMember;

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

	public isUserRegular (member: GuildMember) {
		return member.roles.has(this.roleRegular.id) ||
			member.highestRole.position >= this.roleMod.position ||
			member.permissions.has("ADMINISTRATOR");
	}

	public onRemoveMember (handler: (member: GuildMember) => any) {
		this.onRemoveMemberHandlers.push(handler);
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
			this.log(`${member.displayName} has sent their first message for the ${this.config.talentLossForMessage[1]}.`);

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
			!member.roles.has(this.roleRegular.id) &&
			!member.roles.has(this.roleMod.id) &&
			!member.permissions.has("ADMINISTRATOR")
		) {
			member.addRole(this.roleRegular);
			this.log(`${this.getMemberName(member)} has become a regular!`);
			member.user.send(`
Hey ${this.getMemberName(member)}! You have become a regular on ${this.guild.name}.

As a regular, you may now change your username color whenever you please, using the \`!color\` command.
Examples: \`!color f00\` would make your username bright red, \`!color 123456\` would make you a dark blue.
Like any other of my commands, you may use it in the ${this.guild.name} server or in a PM with me.

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

	private getMemberName (memberOrId: string | GuildMember) {
		const member = typeof memberOrId == "string" ? this.guild.members.find(member => member.id === memberOrId) : memberOrId;
		if (!member) {
			return "Unknown";
		}

		return member.displayName;
	}

	// tslint:disable cyclomatic-complexity
	@Command<RegularsPlugin>("talent", p => p.config.commands !== false)
	protected async commandTalent (message: Message, queryMember?: string) {
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

	@Command<RegularsPlugin>("top", p => p.config.commands !== false)
	protected commandTop (message: Message, quantityStr: string, offsetStr: string) {
		const quantity = isNaN(+quantityStr) ? 3 : Math.max(1, Math.min(20, +quantityStr));
		const offset = isNaN(+offsetStr) ? 1 : Math.max(1, Math.min(20, +offsetStr));

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

	@Command<RegularsPlugin>("talent-add", p => p.config.commands !== false)
	protected async commandTalentAdd (message: Message, queryMember?: string, amtStr?: string) {
		if (!message.member.roles.has(this.roleMod.id) && !message.member.permissions.has("ADMINISTRATOR")) {
			this.reply(message, "only mods may manually modify talent of members.");
			return;
		}

		if (queryMember === undefined || !amtStr) {
			this.reply(message, "you must provide a member to update the talent on and the amount to change the talent by.");
			return;
		}

		const member = await this.findMember(queryMember);
		if (!this.validateFindResult(message, member)) {
			return;
		}

		const trackedMember = this.getTrackedMember(member.id);
		const amt = isNaN(+amtStr) ? 0 : +amtStr;
		trackedMember.talent += amt;

		const operation = `${amt > 0 ? "added" : "subtracted"} ${Math.abs(amt)} talent ${amt > 0 ? "to" : "from"}`;
		this.reply(message, `I ${operation} ${member.displayName}. Their new talent is ${trackedMember.talent}.`);
		this.log(
			message.member.displayName,
			`${operation} ${member.displayName}. Their new talent is ${trackedMember.talent}.`,
		);

		this.updateTopMember(trackedMember);
	}

	@Command<RegularsPlugin>("days", p => p.config.commands !== false)
	protected async commandDaysChatted (message: Message, queryMember?: string) {
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
