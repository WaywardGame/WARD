import { Guild, GuildMember, Message, Role } from "discord.js";

import { Plugin } from "../Plugin";
import { days, hours } from "../util/Time";

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
}

export class RegularsPlugin extends Plugin<RegularsData, IRegularsConfig> {
	public updateInterval = hours(12);

	private members: { [key: string]: ITrackedMember };
	private topMembers: ITrackedMember[];
	private regularRole: Role;
	private guild: Guild;

	public getDefaultId () {
		return "regulars";
	}

	public async onStart (guild: Guild) {
		this.guild = guild;

		this.members = await this.data(RegularsData.TrackedMembers, {});
		this.updateTopMembers();

		this.regularRole = this.guild.roles.find("name", "regular");
	}

	public onUpdate () {
		const today = this.getToday();
		for (const memberId in this.members) {
			const trackedMember = this.members[memberId];

			if (trackedMember.lastDay < today - this.config.daysBeforeTalentLoss) {
				trackedMember.talent--;

				if (trackedMember.talent == 0) {
					const member = this.guild.members.find("id", trackedMember.id);
					member.removeRole(this.regularRole);
					delete this.members[memberId];
				}
			}
		}
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		switch (command) {
			case "talent": return this.commandTalent(message, command, args[0]);
			case "top": return this.commandTop(message);
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
		if (trackedMember.talent > 20 && member.highestRole.position < this.regularRole.position) {
			member.addRole(this.regularRole);
			// TODO congratulate user for becoming a regular
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

	// tslint:disable cyclomatic-complexity
	private commandTalent (message: Message, command: string, queryMember?: string) {
		let member = message.member;

		if (queryMember) {
			member = this.guild.members.find("nickname", queryMember) ||
				this.guild.members.find(m => m.user.username.toLowerCase() == queryMember.toLowerCase());

			if (!member) {
				message.reply("I couldn't find a member by that name.");

				return;
			}
		}

		const memberName = member.nickname || member.user.username;

		const trackedMember = this.members[member.id];
		if (!trackedMember) {
			message.reply(queryMember ?
				`${memberName} has not gained talent yet.` :
				"you have not gained talent yet.",
			);

			return;
		}

		const talent = this.members[member.id].talent;
		message.reply(queryMember ?
			`the talent of ${memberName} is ${talent}.` :
			`your talent is ${talent}.`,
		);
	}

	private getMemberNameFromId (id: string) {
		const member = this.guild.members.find("id", id);
		if (!member) {
			return "Unknown";
		}

		return member.nickname || member.user.username;
	}

	private commandTop (message: Message) {
		message.reply(`
The members with the most talent are:
1. ${this.getMemberNameFromId(this.topMembers[0].id)}: ${this.topMembers[0].talent}
2. ${this.getMemberNameFromId(this.topMembers[1].id)}: ${this.topMembers[1].talent}
3. ${this.getMemberNameFromId(this.topMembers[2].id)}: ${this.topMembers[2].talent}
		`);
	}
}
