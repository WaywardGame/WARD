import { GuildMember, Message, Role } from "discord.js";
import { Command } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Paginator } from "../core/Paginatable";
import { Plugin } from "../core/Plugin";
import Strings from "../util/Strings";
import { days, getTime, hours, minutes } from "../util/Time";

export interface ITrackedMember {
	id: string;
	talent: number;
	lastDay: number;
	daysVisited: number;
	maxTalentForMessageBlockStartTime: number;
	maxTalentForMessageBlockMessagesSent: number;
	talentLossForMessageBlockStartTime: number;
	talentLossForMessageBlockMessagesSent: number;
	autodonate?: [string, number];
}

export interface IRegularsData {
	trackedMembers: Record<string, ITrackedMember>;
}

const baseCommands = {
	helpName: "xp",
	check: "xp",
	rankings: "xp rankings",
	add: "xp add",
	set: "xp set",
	donate: "xp donate",
	autodonate: "xp autodonate",
}

export interface IRegularsConfig {
	scoreName?: string;
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
	commands?: false | Partial<typeof baseCommands>;
}

enum CommandLanguage {
	XpDescription = "Gets the amount of {xp} you or another user has.",
	XpArgumentUser = "You can specify an ID, a username & tag, and a display name. If provided, gets the {xp} of the user specified. If not provided, gets your own {xp}.",
	XpRankingsDescription = "Lists the {xp} rankings of all the tracked users in the server.",
	XpAddDescription = "_(Requires manage members permission.)_ Adds {xp} to a user.",
	XpAddArgumentUser = "A user's ID, partial username & tag, or partial display name.",
	XpAddArgumentAmt = "The amount of {xp} to add to the user.",
	XpSetDescription = "_(Requires manage members permission.)_ Sets the {xp} of a user.",
	XpSetArgumentUser = "A user's ID, partial username & tag, or partial display name.",
	XpSetArgumentAmt = "The amount to set the user's {xp} to.",
	XpDonateDescription = "Donates some of your {xp} to another user. Both you and the target user must be regulars of the server. (Unless you're a mod.)",
	XpDonateArgumentAmt = "The amount of {xp} to donate.",
	XpDonateArgumentUser = "A user's ID, partial username & tag, or partial display name.",
	XpAutodonateDescription = "Returns your current autodonation setting — whether you are autodonating, and if so, who to.",
	XpAutodonateSetDescription = "Sets up autodonation to the target user.",
	XpAutodonateSetArgumentUser = "The donation target, specified as a user's ID, partial username & tag, or partial display name.",
	XpAutodonateSetArgumentAmt = "_Defaults to your current {xp}_. The amount of {xp} you will maintain. Any {xp} you collect _exceeding_ this value will be forwarded to the target user.",
	XpAutodonateRemoveDescription = "Disables autodonation.",
}

export class RegularsPlugin extends Plugin<IRegularsConfig, IRegularsData> {
	public updateInterval = hours(12);
	public autosaveInterval = minutes(30);

	private members: { [key: string]: ITrackedMember };
	private topMembers: ITrackedMember[];
	private roleRegular: Role;
	private roleMod: Role;
	private readonly onRemoveMemberHandlers: ((member: GuildMember) => any)[] = [];
	private readonly talentMultiplierIncreaseDays = new Map<number, number>();

	public getDefaultId () {
		return "regulars";
	}

	public getDescription () {
		return "A plugin for tracking how 'regular' users are, giving them points for activity and roles if they've been active for a while.";
	}

	public isHelpVisible () {
		return this.config.commands !== false;
	}

	private readonly help = () => new HelpContainerPlugin()
		.setTextFilter(text => text.replace(/{xp}/g, this.getScoreName()))
		.addCommand(this.getCommandName("check"), CommandLanguage.XpDescription, command => command
			.addArgument("user", CommandLanguage.XpArgumentUser))
		.addCommand(this.getCommandName("rankings"), CommandLanguage.XpRankingsDescription)
		.addCommand(this.getCommandName("donate"), CommandLanguage.XpDonateDescription, command => command
			.addArgument("amt", CommandLanguage.XpDonateArgumentAmt)
			.addArgument("user", CommandLanguage.XpDonateArgumentUser))
		.addCommand(this.getCommandName("autodonate"), CommandLanguage.XpAutodonateDescription)
		.addCommand(this.getCommandName("autodonate"), CommandLanguage.XpAutodonateSetDescription, command => command
			.addArgument("user", CommandLanguage.XpAutodonateSetArgumentUser)
			.addArgument("amt", CommandLanguage.XpAutodonateSetArgumentAmt, argument => argument
				.setOptional()))
		.addCommand(`${this.getCommandName("autodonate")} remove|off`, CommandLanguage.XpAutodonateRemoveDescription)
		.addCommand(this.getCommandName("add"), CommandLanguage.XpAddDescription, command => command
			.addArgument("user", CommandLanguage.XpAddArgumentUser)
			.addArgument("amt", CommandLanguage.XpAddArgumentAmt))
		.addCommand(this.getCommandName("set"), CommandLanguage.XpSetDescription, command => command
			.addArgument("user", CommandLanguage.XpSetArgumentUser)
			.addArgument("amt", CommandLanguage.XpSetArgumentAmt));

	@Command<RegularsPlugin>(p => p.getCommandName("helpName") && [`help ${p.getCommandName("helpName")}`, `${p.getCommandName("helpName")} help`], p => p.config.commands !== false)
	protected async commandHelp (message: Message) {
		this.reply(message, this.help());
		return true;
	}

	public async onStart () {
		this.members = this.getData("trackedMembers", {});
		this.updateTopMembers();

		this.roleRegular = this.guild.roles.find(role => role.name === "regular");
		this.roleMod = this.guild.roles.find(role => role.name === "mod");

		this.talentMultiplierIncreaseDays.clear();
		const calculateDaysUpTill = 10000;
		new Array(calculateDaysUpTill)
			.fill(0)
			.map((_, i) => [Math.floor(this.getMultiplier(calculateDaysUpTill - i)), (calculateDaysUpTill - i)])
			.forEach(([multiplier, day]) => this.talentMultiplierIncreaseDays.set(multiplier, day));
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
				this.logger.warning(`Member '${this.getMemberName(member)}' is regular but not tracked`);
				// this.removeRegularFromMember(member);
			}
		}
	}

	private dropTrackedMember (trackedMember: ITrackedMember) {
		const member = this.guild.members.find(member => member.id === trackedMember.id);
		this.removeRegularFromMember(member);

		delete this.members[trackedMember.id];
		this.logger.info(`Dropped tracked member '${this.getMemberName(member)}'`);
	}

	private removeRegularFromMember (member: GuildMember) {
		if (member && !member.roles.has(this.roleMod.id) && !member.permissions.has("ADMINISTRATOR")) {
			member.removeRole(this.roleRegular);
			this.onRemoveMemberHandlers.forEach(handler => handler(member));
			this.logger.info(`Removed regular from member '${this.getMemberName(member)}'`);
		}
	}

	public onMessage (message: Message) {
		// DMs are not counted towards talent
		if (!message.guild)
			return;

		// excluded channels are not counted towards talent
		if (this.config.excludedChannels && this.config.excludedChannels.includes(message.channel.id))
			return;

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
				daysVisited: 1,
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

	public getMemberName (memberOrId: string | GuildMember) {
		const member = typeof memberOrId == "string" ? this.guild.members.find(member => member.id === memberOrId) : memberOrId;
		if (!member) {
			return undefined;
		}

		return member.displayName || member.user.username;
	}

	private async onMemberMessage (member: GuildMember) {
		const pronouns = await this.getPronouns(member);

		const trackedMember = this.getTrackedMember(member.id);

		let talentChange = this.config.talentForMessage;

		if (trackedMember.maxTalentForMessageBlockStartTime + getTime(this.config.maxTalentForMessage[1]) < Date.now()) {
			trackedMember.maxTalentForMessageBlockStartTime = Date.now();
			trackedMember.maxTalentForMessageBlockMessagesSent = 0;
			this.logger.verbose(`${member.displayName} has sent ${pronouns.their} first message for the hour.`);

		} else if (trackedMember.maxTalentForMessageBlockMessagesSent > this.config.maxTalentForMessage[0]) {
			talentChange = 0;
			this.logger.info(`${member.displayName} has earned the maximum ${this.getScoreName()} for the hour.`);
		}

		trackedMember.maxTalentForMessageBlockMessagesSent++;

		if (trackedMember.talentLossForMessageBlockStartTime + getTime(this.config.talentLossForMessage[1]) < Date.now()) {
			trackedMember.talentLossForMessageBlockStartTime = Date.now();
			trackedMember.talentLossForMessageBlockMessagesSent = 0;
			this.logger.verbose(`${member.displayName} has sent ${pronouns.their} first message for the ${this.config.talentLossForMessage[1]}.`);

		} else if (trackedMember.talentLossForMessageBlockMessagesSent > this.config.talentLossForMessage[0]) {
			talentChange = -this.config.talentLossForMessage[2];
			this.logger.info(`${member.displayName} is sending too many messages!`);
		}

		trackedMember.talentLossForMessageBlockMessagesSent++;

		this.updateMember(member, talentChange);
	}

	public getScoreName () {
		return this.config.scoreName || "talent";
	}

	private getToday () {
		return Math.floor(Date.now() / days(1));
	}

	private getMultiplier (days: number) {
		return +(1 + (days * this.config.daysVisitedMultiplier) ** this.config.daysVisitedMultiplierReduction).toFixed(2);
	}

	private updateMember (member: GuildMember, score: number) {
		const today = this.getToday();
		const trackedMember = this.getTrackedMember(member.id);

		const multiplier = this.getMultiplier(trackedMember.daysVisited);

		if (trackedMember.lastDay < today) {
			trackedMember.daysVisited++;
			trackedMember.lastDay = today;
			trackedMember.talent += Math.floor(this.config.talentForNewDay * multiplier);
		}

		trackedMember.talent += Math.floor(score * multiplier);
		this.autoDonate(trackedMember);

		this.checkMemberRegular(member);

		this.updateTopMember(trackedMember);
	}

	private checkMemberRegular (member: GuildMember) {
		const trackedMember = this.getTrackedMember(member.id);
		const shouldBeRegular = trackedMember.talent > this.config.regularMilestoneTalent
			|| member.roles.has(this.roleMod.id)
			|| member.permissions.has("ADMINISTRATOR");

		if (shouldBeRegular && !member.roles.has(this.roleRegular.id)) {
			member.addRole(this.roleRegular);
			this.logger.info(`${this.getMemberName(member)} has become a regular!`);
			this.event.emit("becomeRegular", member);
		}
	}

	private updateTopMember (...trackedMembers: ITrackedMember[]) {
		for (const trackedMember of trackedMembers)
			if (!this.topMembers.some(a => a.id == trackedMember.id))
				this.topMembers.push(trackedMember);

		this.topMembers.sort((a, b) => b.talent - a.talent);
	}

	private updateTopMembers () {
		this.topMembers = Object.values(this.members);
		this.topMembers.sort((a, b) => b.talent - a.talent);
	}

	private isMod (member: GuildMember) {
		return member.roles.has(this.roleMod.id)
			|| member.permissions.has("ADMINISTRATOR");
	}

	private getCommandName (command: keyof Exclude<IRegularsConfig["commands"], false | undefined>) {
		return (this.config.commands && this.config.commands[command])
			|| baseCommands[command];
	}

	// tslint:disable cyclomatic-complexity
	// @Command<RegularsPlugin>(p => p.config.commands && p.config.commands.check || "talent", p => p.config.commands !== false)
	// protected async commandTalent (message: Message, queryMember?: string) {
	// 	let member = message.member;

	// 	if (queryMember) {
	// 		const resultingQueryMember = await this.findMember(queryMember);

	// 		if (!this.validateFindResult(message, resultingQueryMember)) {
	// 			return;
	// 		}

	// 		member = resultingQueryMember;
	// 	}

	// 	const memberName = member.displayName;

	// 	if (member.user.bot) {
	// 		this.reply(message, member.id == this.user.id ?
	// 			`my ${this.getScoreName()} is limitless.` :
	// 			`the ${this.getScoreName()} of ${memberName} is limitless.`,
	// 		);

	// 		return;
	// 	}

	// 	const trackedMember = this.members[member.id];
	// 	if (!trackedMember) {
	// 		this.reply(message, queryMember ?
	// 			`${memberName} has not gained ${this.getScoreName()} yet.` :
	// 			`you have not gained ${this.getScoreName()} yet.`,
	// 		);

	// 		return;
	// 	}

	// 	const talent = this.members[member.id].talent;
	// 	this.reply(message, queryMember ?
	// 		`the ${this.getScoreName()} of ${memberName} is ${Intl.NumberFormat().format(talent)}.` :
	// 		`your ${this.getScoreName()} is ${Intl.NumberFormat().format(talent)}.`,
	// 	);
	// }

	// tslint:disable cyclomatic-complexity
	@Command<RegularsPlugin>(p => p.getCommandName("check"), p => p.config.commands !== false)
	protected async commandTalent (message: Message, queryMember?: string) {
		let member = message.member;

		if (queryMember) {
			const resultingQueryMember = await this.findMember(queryMember);

			if (!this.validateFindResult(message, resultingQueryMember)) {
				return false;
			}

			member = resultingQueryMember;
		}

		const memberName = member.displayName;

		if (member.user.bot) {
			const who = member.id == this.user.id ? `my ${this.getScoreName()}` : `the ${this.getScoreName()} of ${memberName}`;
			this.reply(message, `having existed since before the beginning of time itself, ${who} cannot be represented in a number system of mortals.`);
			return true;
		}

		const trackedMember = this.members[member.id];
		if (!trackedMember) {
			this.reply(message, queryMember ?
				`${memberName} has not gained ${this.getScoreName()} yet.` :
				`you have not gained ${this.getScoreName()} yet.`,
			);

			return true;
		}

		const days = this.members[member.id].daysVisited;
		const multiplier = this.getMultiplier(days);
		const multiplierFloored = Math.floor(multiplier);
		const daysUntilMultiplierUp = this.talentMultiplierIncreaseDays.get(multiplierFloored + 1)! - days;
		const resultIs = `is **${Intl.NumberFormat().format(trackedMember.talent)}**. (Days chatted: ${days}. Multiplier: ${Intl.NumberFormat().format(multiplier)}x. Days till ${multiplierFloored + 1}x: ${daysUntilMultiplierUp})`;
		this.reply(message, queryMember ?
			`the ${this.getScoreName()} of ${memberName} ${resultIs}` :
			`your ${this.getScoreName()} ${resultIs}`,
		);

		return true;
	}

	@Command<RegularsPlugin>(p => p.getCommandName("rankings"), p => p.config.commands !== false)
	protected commandTop (message: Message /*, offsetStr: string, quantityStr: string */) {
		// const offset = isNaN(+offsetStr) ? 0 : Math.max(1, /*Math.min(20,*/ Math.floor(+offsetStr)/*)*/) - 1;
		// const quantity = isNaN(+quantityStr) ? 20 : Math.max(1, Math.min(20, Math.floor(+quantityStr)));

		const members = (this.topMembers
			.map(member => [this.getMemberName(member.id), Intl.NumberFormat().format(member.talent)] as const)
			.filter(([name]) => name) as [string, string][])
			// .slice(offset, offset + quantity)
			;

		const pages: string[] = [];
		const quantity = 25;
		for (let offset = 0; offset < members.length; offset += quantity) {
			const max = offset + quantity;
			const slice = members.slice(offset, max);

			let response = "";

			const maxLengthName = slice.map(([name]) => name.length).splat(Math.max);
			const maxLengthTalent = slice.map(([, talent]) => talent.length).splat(Math.max);

			response += slice.map(([name, talent], i) =>
				`${`${(offset + i + 1)}`.padStart(`${max}`.length, " ")}. ${`${name}`.padEnd(maxLengthName, " ")} ${talent.padStart(maxLengthTalent, " ")}`)
				.join("\n");

			const scoreName = this.getScoreName();
			if (slice.length < quantity)
				response += `\n...no more members with ${scoreName}`;

			pages.push(`\`\`\`${response}\`\`\``);
		}

		Paginator.create(pages)
			.setPageHeader(`__**${this.getScoreName()} Rankings!**__ (Page **{page}** of **{total}**)`)
			.reply(message);

		return true;
	}

	@Command<RegularsPlugin>(p => p.getCommandName("add"))
	protected async commandTalentAdd (message: Message, queryMember?: string, amtStr?: string) {
		if (!this.isMod(message.member))
			// this.reply(message, "only mods may manually modify talent of members.");
			return true;

		if (queryMember === undefined || !amtStr) {
			this.reply(message, `you must provide a member to update the ${this.getScoreName()} on and the amount to change the ${this.getScoreName()} by.`);
			return false;
		}

		const member = await this.findMember(queryMember);
		if (!this.validateFindResult(message, member)) {
			return false;
		}

		const pronouns = await this.getPronouns(member);

		const trackedMember = this.getTrackedMember(member.id);
		const amt = isNaN(+amtStr) ? 0 : +amtStr;
		trackedMember.talent += amt;

		const operation = `${amt > 0 ? "added" : "subtracted"} ${Intl.NumberFormat().format(Math.abs(amt))} ${this.getScoreName()} ${amt > 0 ? "to" : "from"}`;
		const reply = `${operation} ${member.displayName}. ${Strings.sentence(pronouns.their)} new ${this.getScoreName()} is ${Intl.NumberFormat().format(trackedMember.talent)}.`;
		this.reply(message, `I ${reply}`);
		this.logger.info(message.member.displayName, reply);

		this.updateTopMember(trackedMember);
		return true;
	}

	@Command<RegularsPlugin>(p => p.getCommandName("set"))
	protected async commandTalentSet (message: Message, queryMember?: string, amtStr?: string) {
		if (!this.isMod(message.member))
			// this.reply(message, "only mods may manually modify talent of members.");
			return true;

		if (queryMember === undefined || !amtStr) {
			this.reply(message, `you must provide a member to update the ${this.getScoreName()} on and the amount to set the ${this.getScoreName()} to.`);
			return false;
		}

		const member = await this.findMember(queryMember);
		if (!this.validateFindResult(message, member))
			return false;

		const trackedMember = this.getTrackedMember(member.id);
		const amt = isNaN(+amtStr) ? 0 : +amtStr;
		trackedMember.talent = amt;

		const operation = `set the ${this.getScoreName()} of ${member.displayName} to ${Intl.NumberFormat().format(Math.abs(amt))}`;
		const reply = `${operation}.`;
		this.reply(message, `I ${reply}`);
		this.logger.info(message.member.displayName, reply);

		this.updateTopMember(trackedMember);
		return true;
	}

	@Command<RegularsPlugin>(p => p.getCommandName("donate"), p => p.config.commands !== false)
	protected async commandTalentDonate (message: Message, amtStr?: string, queryMember?: string) {
		if (queryMember === undefined) {
			this.reply(message, `you must provide a member to donate ${this.getScoreName()} to.`);
			return false;
		}

		const amt = Math.floor(+amtStr!);
		if (isNaN(amt)) {
			this.reply(message, `you must provide an amount of ${this.getScoreName()} to donate.`);
			return false;
		}

		if (amt < 1) {
			this.reply(message, `you must donate a positive amount of ${this.getScoreName()}. No stealing allowed 😡`);
			return false;
		}

		const trackedMember = this.members[message.member.id];
		if (!message.member.roles.has(this.roleRegular.id)) {
			this.reply(message, `only regulars can donate ${this.getScoreName()}.`);
			return true;
		}

		if (trackedMember.talent - this.config.regularMilestoneTalent < amt) {
			this.reply(message, `you do not have enough ${this.getScoreName()} to donate ${amt}.`);
			return true;
		}

		const member = await this.findMember(queryMember);
		if (!this.validateFindResult(message, member))
			return false;

		const updatingMember = this.getTrackedMember(member.id);
		if (!member.roles.has(this.roleRegular.id) && !this.isMod(message.member)) {
			this.reply(message, `only mods can donate to non-regular users.`);
			return true;
		}

		const pronouns = await this.getPronouns(member);

		trackedMember.talent -= amt;
		updatingMember.talent += amt;
		this.autoDonate(updatingMember);

		const self = message.member.id === member.id;

		const operation = `donated ${Intl.NumberFormat().format(Math.abs(amt))} ${this.getScoreName()} to ${self ? "yourself" : member.displayName}`;
		const theirNew = `new ${this.getScoreName()} is ${Intl.NumberFormat().format(updatingMember.talent)}`;
		const yourNew = `new ${this.getScoreName()} is ${Intl.NumberFormat().format(trackedMember.talent)}`;
		const result = self ? "In other words, nothing happened." : `${Strings.sentence(pronouns.their)} ${theirNew}. Your ${yourNew}.`;
		this.reply(message, `you ${operation}. ${result}`);

		if (!self)
			this.logger.info(message.member.displayName, `${operation}. ${member.displayName}'s ${theirNew}. ${message.member.displayName}'s ${yourNew}.`);

		this.updateTopMember(trackedMember, updatingMember);
		return true;
	}

	@Command<RegularsPlugin>(p => p.getCommandName("autodonate"), p => p.config.commands !== false)
	protected async commandTalentAutoDonate (message: Message, queryMember?: string, amtStr?: string) {
		const trackedMember = this.members[message.member.id];
		if (queryMember === undefined) {
			const [donateMemberId, donateMinAmt] = trackedMember.autodonate || [];
			this.reply(message, `${donateMemberId ? `you are currently auto-donating to ${this.getMemberName(donateMemberId)} when your ${this.getScoreName()} exceeds ${Intl.NumberFormat().format(donateMinAmt!)}` : `you must provide a member to donate ${this.getScoreName()} to`}. (Use "remove" or "off" to turn off auto-donation.)`);
			return true;
		}

		if (queryMember === "remove" || queryMember === "off") {
			delete trackedMember.autodonate;
			this.reply(message, "you have turned off auto-donation.");
			return true;
		}

		const member = await this.findMember(queryMember);
		if (!this.validateFindResult(message, member))
			return false;

		const updatingMember = this.getTrackedMember(member.id);
		if (!member.roles.has(this.roleRegular.id) && !this.isMod(message.member)) {
			this.reply(message, `only mods can donate to non-regular users.`);
			return true;
		}

		if (trackedMember.id === updatingMember.id) {
			this.reply(message, `You cannot set up auto-donation to yourself. That makes no sense, you big dumdum.`);
			return true;
		}

		const minTalent = Math.max(this.config.regularMilestoneTalent, Math.floor(+amtStr!) || trackedMember.talent);
		trackedMember.autodonate = [updatingMember.id, minTalent];

		const donatedResult = this.autoDonate(trackedMember);
		let result: string | undefined;
		if (donatedResult) {
			const pronouns = await this.getPronouns(member);
			const theirNew = `new ${this.getScoreName()} is ${Intl.NumberFormat().format(updatingMember.talent)}`;
			const yourNew = `new ${this.getScoreName()} is ${Intl.NumberFormat().format(trackedMember.talent)}`;
			result = `To start with, you ${donatedResult}. ${Strings.sentence(pronouns.their)} ${theirNew}. Your ${yourNew}.`;
		}

		const operation = `enabled auto-donation to ${member.displayName}${minTalent > this.config.regularMilestoneTalent ? `, when your ${this.getScoreName()} exceeds ${Intl.NumberFormat().format(minTalent)}` : ""}`;

		this.reply(message, `you ${operation}. ${result || ""}`);
		this.logger.info(message.member.displayName, `${operation}.`);

		this.updateTopMember(trackedMember, updatingMember);
		return true;
	}

	public autoDonate (trackedMember: ITrackedMember, donationChain = new Set<string>()) {
		const autoDonate = trackedMember.autodonate;
		if (!autoDonate)
			return;

		const [donateMemberId, donateDownTo] = autoDonate;
		const donateMember = this.getTrackedMember(donateMemberId);

		const donateAmount = trackedMember.talent - Math.max(this.config.regularMilestoneTalent, donateDownTo);
		if (donateAmount <= 0)
			return;

		trackedMember.talent -= donateAmount;
		donateMember.talent += donateAmount;

		if (!donationChain.has(trackedMember.id)) {
			donationChain.add(trackedMember.id);
			this.autoDonate(donateMember, donationChain);
		}

		const donateTargetName = this.getMemberName(donateMemberId);
		this.logger.verbose(this.getMemberName(trackedMember.id), `auto-donated ${donateAmount} ${this.getScoreName()} to`, donateTargetName);
		return `donated ${Intl.NumberFormat().format(Math.abs(donateAmount))} ${this.getScoreName()} to ${donateTargetName}`;
	}

	// @Command<RegularsPlugin>(p => p.config.commands && p.config.commands.days || "days", p => p.config.commands !== false)
	// protected async commandDaysChatted (message: Message, queryMember?: string) {
	// 	let member = message.member;

	// 	if (queryMember) {
	// 		const resultingQueryMember = await this.findMember(queryMember);

	// 		if (!this.validateFindResult(message, resultingQueryMember)) {
	// 			return;
	// 		}

	// 		member = resultingQueryMember;
	// 	}

	// 	const memberName = member.displayName;

	// 	if (member.user.bot) {
	// 		this.reply(message, member.id == this.user.id ?
	// 			"I have existed longer than time itself." :
	// 			`${memberName} has existed longer than time itself.`,
	// 		);

	// 		return;
	// 	}

	// 	const trackedMember = this.members[member.id];
	// 	if (!trackedMember) {
	// 		this.reply(message, queryMember ?
	// 			`${memberName} has not gained ${this.getScoreName()} yet.` :
	// 			`you have not gained ${this.getScoreName()} yet.`,
	// 		);

	// 		return;
	// 	}

	// 	const daysVisited = this.members[member.id].daysVisited;
	// 	this.reply(message, queryMember ?
	// 		`${memberName} has chatted on ${Intl.NumberFormat().format(daysVisited)} days.` :
	// 		`you have chatted on ${Intl.NumberFormat().format(daysVisited)} days.`,
	// 	);
	// }
}
