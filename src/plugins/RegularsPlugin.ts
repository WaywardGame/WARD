import { Guild, GuildMember, Message, Role } from "discord.js";

import { Plugin } from "../Plugin";
import { days } from "../util/Time";

interface ITrackedUser {
	id: string;
	talent: number;
	lastDay: number;
	daysVisited: number;
}

export enum RegularsData {
	TrackedUsers,
}

export class RegularsPlugin extends Plugin<RegularsData> {
	private members: { [key: string]: ITrackedUser };
	private regularRole: Role;
	private guild: Guild;

	public getDefaultId () {
		return "regulars";
	}

	public async onStart (guild: Guild) {
		this.guild = guild;

		this.members = await this.getData(RegularsData.TrackedUsers);
		if (!this.members) {
			await this.setData(RegularsData.TrackedUsers, this.members = {});
		}

		this.regularRole = this.guild.roles.find("name", "regular");
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		if (command === "talent") {
			this.commandTalent(message, command, args[0]);
		}
	}

	public onMessage (message: Message) {
		this.updateMember(message.member, 1);
	}

	private updateMember (member: GuildMember, score: number) {
		const today = Math.floor(Date.now() / days(1));

		let trackedMember = this.members[member.id];
		if (!trackedMember) {
			trackedMember = this.members[member.id] = {
				id: member.id,
				talent: 0,
				daysVisited: 0,
				lastDay: today,
			};
		}

		const multiplier = 1 + trackedMember.daysVisited / 10;

		if (trackedMember.lastDay < today) {
			trackedMember.daysVisited++;
			trackedMember.lastDay = today;
			trackedMember.talent += Math.floor(50 * multiplier);
		}

		trackedMember.talent += Math.floor(score * multiplier);
		if (trackedMember.talent > 20 && member.highestRole.position < this.regularRole.position) {
			member.addRole(this.regularRole);
			// TODO congratulate user for becoming a regular
		}
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
}
