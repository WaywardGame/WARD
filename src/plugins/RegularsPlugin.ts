import chalk from "chalk";
import { GuildMember, Message, MessageEmbed, TextChannel, User } from "discord.js";
import { Command, CommandMessage, CommandResult, IField, ImportPlugin } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Paginator } from "../core/Paginatable";
import { Plugin } from "../core/Plugin";
import Random from "../util/Random";
import Strings from "../util/Strings";
import { days, getTime, hours, minutes } from "../util/Time";
import PronounsPlugin from "./PronounsPlugin";

export interface ITrackedMember {
	id: string;
	xp: number;
	lastDay: number;
	streak?: number;
	daysVisited: number;
	maxXpForMessageBlockStartTime: number;
	maxXpForMessageBlockMessagesSent: number;
	xpLossForMessageBlockStartTime: number;
	xpLossForMessageBlockMessagesSent: number;
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
	warningChannel?: string;
	daysBeforeXpLoss: number;
	xpLossAmount: number;
	xpForNewDay: number;
	xpForMessage: number;
	// 0: maximum xp in 1: amount of time
	maxXpForMessage: [number, string];
	// 0: amount of xp in 1: amount of time where any additional messages reduce your talent by 2: amount
	xpLossForMessage: [number, string, number];
	daysVisitedMultiplier: number;
	daysVisitedMultiplierReduction: number;
	regularMilestoneXp: number;
	commands?: false | Partial<typeof baseCommands>;
	role: string;
	removeRegularWarning?: number;
	rolesWithRegular?: string[];
	notChattedMessages?: string[];
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

	@ImportPlugin("pronouns")
	private pronouns: PronounsPlugin = undefined!;

	public updateInterval = hours(12);
	public autosaveInterval = minutes(5);

	private get members () { return this.data.trackedMembers; }
	private get warningChannel () { return !this.config.warningChannel ? undefined : this.guild.channels.cache.get(this.config.warningChannel) as TextChannel; }
	private topMembers: ITrackedMember[];
	private readonly onRemoveMemberHandlers: ((member: GuildMember) => any)[] = [];
	private readonly xpMultiplierIncreaseDays = new Map<number, number>();

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
	protected async commandHelp (message: CommandMessage) {
		this.reply(message, this.help());
		return CommandResult.pass();
	}

	protected initData = () => ({ trackedMembers: {} });

	public async onStart () {
		this.updateTopMembers();

		await this.guild.roles.fetch(undefined, undefined, true);

		this.xpMultiplierIncreaseDays.clear();
		const calculateDaysUpTill = 10000;
		new Array(calculateDaysUpTill)
			.fill(0)
			.map((_, i) => [Math.floor(this.getMultiplier(calculateDaysUpTill - i)), (calculateDaysUpTill - i)])
			.forEach(([multiplier, day]) => this.xpMultiplierIncreaseDays.set(multiplier, day));
	}

	public async onUpdate () {
		if (this.guild.members.cache.size < 3) {
			this.logger.warning("Saw less than three members in guild, exiting early in case something is wrong.");
			return;
		}

		const today = this.getToday();
		const shouldDrop: GuildMember[] = [];
		for (const memberId of Object.keys(this.members)) {
			const trackedMember = this.members[memberId];

			if (trackedMember.lastDay < today - 1) {
				trackedMember.streak = 0;
				this.data.markDirty();
			}

			if (trackedMember.lastDay < today - this.config.daysBeforeXpLoss) {
				trackedMember.xp -= this.config.xpLossAmount;
				this.data.markDirty();
			}

			if (trackedMember.xp <= 0) {
				const member = this.guild.members.cache.get(trackedMember.id);
				if (member)
					shouldDrop.push(member);
				else {
					// if this member isn't part of the guild, delete them straightaway!!
					delete this.members[memberId];
					this.data.markDirty();
				}
			}
		}

		const regularRemoveWarning = this.config.removeRegularWarning ?? 10;
		if (shouldDrop.length < regularRemoveWarning) {
			await this.dropTrackedMembers();
			return;
		}

		const warning = [
			`Trying to drop (& potentially remove "regular") from ${chalk.yellowBright(`${shouldDrop.length} users`)}. A user list exceeding ${chalk.yellowBright(`${regularRemoveWarning} users`)} must be manually confirmed.\nTo proceed send command ${chalk.cyan(`${this.commandPrefix}regular remove confirm`)}`,
			...shouldDrop.map(member => `${member.displayName} (ID: ${chalk.grey(member.id)})`),
		];
		this.logger.warning(warning.join("\n\t"));

		if (this.warningChannel) {
			this.sendAll(this.warningChannel,
				`Trying to drop (& potentially remove "regular") from **${shouldDrop.length} users**. A user list exceeding **${regularRemoveWarning} users** must be manually confirmed.`,
				`To proceed send command \`${this.commandPrefix}regular remove confirm\``,
				...shouldDrop.map(member => `> ${member.displayName} (ID: ${member.id})`));
		}
	}

	private async dropTrackedMembers () {
		let removed = false;
		for (const trackedMember of Object.values(this.members))
			if (trackedMember.xp <= 0) {
				removed = true;
				await this.dropTrackedMember(trackedMember);
			}

		await this.checkRegularUntracked();
		return removed;
	}

	@Command("regular remove confirm")
	protected async onRegularRemoveConfirm (message: CommandMessage) {
		if (!this.isMod(message.member))
			return CommandResult.pass();

		if (!await this.dropTrackedMembers())
			this.checkRegularUntracked(true);

		return CommandResult.pass();
	}

	private async checkRegularUntracked (remove = false) {
		const membersRegularAndUntracked = (await this.guild.members.fetch({ force: true }))
			.filter(member => !this.getTrackedMember(member.id, false) // is untracked
				&& member.roles.cache.has(this.config.role) // is regular
				&& !this.shouldUserBeRegular(member)); // should not be regular

		let removed: string[] = [];
		for (const [, member] of membersRegularAndUntracked) {
			this.logger.warning(`Member '${member.displayName}' is regular but not tracked`);

			if (remove) {
				await this.removeRegularFromMember(member);
				removed.push(member.displayName);

			} else {
				this.warningChannel?.send(`Member '${member.displayName}' is regular but not tracked. This can happen due to unrelated issues with the bot. If this user hasn't sent messages in a while, confirm their regular removal with: \`${this.commandPrefix}regular remove confirm\``);
			}
		}

		if (removed.length)
			this.warningChannel?.send(`Removed regular from ${removed.join(", ")}.`);
	}

	private async dropTrackedMember (trackedMember: ITrackedMember) {
		const member = this.guild.members.cache.get(trackedMember.id);
		await this.removeRegularFromMember(member);

		delete this.members[trackedMember.id];
		this.data.markDirty();
		this.logger.info(`Dropped tracked member '${member ? this.getMemberName(member) : trackedMember.id}'`);
	}

	private async removeRegularFromMember (member?: GuildMember) {
		if (member && !this.shouldUserBeRegular(member) && member.roles.cache.has(this.config.role)) {
			await member.roles.remove(this.config.role)
				.catch(err => this.logger.warning("Could not remove regular from member", member.displayName, err.message));
			this.logger.info(`Removed regular from member '${this.getMemberName(member)}'`);
			await Promise.all(this.onRemoveMemberHandlers.map(handler => handler(member)));
			return true;
		}

		return false;
	}

	public onMessage (message: Message) {
		// DMs are not counted towards xp
		if (!message.guild || !message.member)
			return;

		// excluded channels are not counted towards xp
		if (this.config.excludedChannels && this.config.excludedChannels.includes(message.channel.id))
			return;

		this.onMemberMessage(message.member);
	}

	public getTrackedMember (id: string): ITrackedMember;
	public getTrackedMember (id: string, create: false): ITrackedMember | undefined;
	public getTrackedMember (id: string, create = true) {
		const today = this.getToday();

		let trackedMember = this.members[id];
		if (!create) return trackedMember;

		if (!trackedMember) {
			trackedMember = this.members[id] = {
				id,
				xp: 0,
				daysVisited: 1,
				lastDay: today,
				streak: 1,
				maxXpForMessageBlockStartTime: Date.now(),
				maxXpForMessageBlockMessagesSent: 0,
				xpLossForMessageBlockStartTime: Date.now(),
				xpLossForMessageBlockMessagesSent: 0,
			};
		}

		return trackedMember;
	}

	public isUserRegular (user?: User | GuildMember) {
		if (user instanceof User)
			user = this.guild.members.cache.get(user.id);

		return !user ? false : user.roles.cache.has(this.config.role)
			|| this.shouldUserBeRegular(user);
	}

	private shouldUserBeRegular (user?: User | GuildMember) {
		if (user instanceof User)
			user = this.guild.members.cache.get(user.id);

		const trackedMember = user && this.getTrackedMember(user.id, false);

		return !user ? false
			: this.isMod(user)
			|| (!trackedMember ? false : trackedMember.xp > this.config.regularMilestoneXp)
			|| this.doesMemberHaveRegularFromOtherRole(user);
	}

	public onRemoveMember (handler: (member: GuildMember) => any) {
		this.onRemoveMemberHandlers.push(handler);
	}

	public getMemberName (memberOrId: string | GuildMember) {
		const member = typeof memberOrId == "string" ? this.guild.members.cache.get(memberOrId) : memberOrId;
		if (!member) {
			return undefined;
		}

		return member.displayName || member.user.username;
	}

	private async onMemberMessage (member: GuildMember) {
		const pronouns = this.pronouns.referTo(member);

		const trackedMember = this.getTrackedMember(member.id);

		let xpChange = this.config.xpForMessage;

		if (trackedMember.maxXpForMessageBlockStartTime + getTime(this.config.maxXpForMessage[1]) < Date.now()) {
			trackedMember.maxXpForMessageBlockStartTime = Date.now();
			trackedMember.maxXpForMessageBlockMessagesSent = 0;
			this.logger.verbose(`${member.displayName} has sent ${pronouns.their} first message for the hour.`);

		} else if (trackedMember.maxXpForMessageBlockMessagesSent > this.config.maxXpForMessage[0]) {
			xpChange = 0;
			this.logger.info(`${member.displayName} has earned the maximum ${this.getScoreName()} for the hour.`);
		}

		trackedMember.maxXpForMessageBlockMessagesSent++;

		if (trackedMember.xpLossForMessageBlockStartTime + getTime(this.config.xpLossForMessage[1]) < Date.now()) {
			trackedMember.xpLossForMessageBlockStartTime = Date.now();
			trackedMember.xpLossForMessageBlockMessagesSent = 0;
			this.logger.verbose(`${member.displayName} has sent ${pronouns.their} first message for the ${this.config.xpLossForMessage[1]}.`);

		} else if (trackedMember.xpLossForMessageBlockMessagesSent > this.config.xpLossForMessage[0]) {
			xpChange = -this.config.xpLossForMessage[2];
			this.logger.info(`${member.displayName} is sending too many messages!`);
		}

		trackedMember.xpLossForMessageBlockMessagesSent++;

		this.updateMember(member, xpChange);
	}

	public getScoreName () {
		return this.config.scoreName || "xp";
	}

	public autoDonate (trackedMember: ITrackedMember, donationChain = new Set<string>()) {
		const autoDonate = trackedMember.autodonate;
		if (!autoDonate)
			return;

		const [donateMemberId, donateDownTo] = autoDonate;
		const donateMember = this.getTrackedMember(donateMemberId);

		const donateAmount = trackedMember.xp - Math.max(this.config.regularMilestoneXp, donateDownTo);
		if (donateAmount <= 0)
			return;

		trackedMember.xp -= donateAmount;
		donateMember.xp += donateAmount;
		this.data.markDirty();

		if (!donationChain.has(trackedMember.id)) {
			donationChain.add(trackedMember.id);
			this.autoDonate(donateMember, donationChain);
		}

		const donateTargetName = this.getMemberName(donateMemberId);
		this.logger.verbose(this.getMemberName(trackedMember.id), `auto-donated ${donateAmount} ${this.getScoreName()} to`, donateTargetName);
		return `donated ${Intl.NumberFormat().format(Math.abs(donateAmount))} ${this.getScoreName()} to ${donateTargetName}`;
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
			trackedMember.streak = (trackedMember.streak ?? 0) + 1;
			trackedMember.xp += Math.floor(this.config.xpForNewDay * multiplier);
		}

		trackedMember.xp += Math.floor(score * multiplier);
		this.autoDonate(trackedMember);

		this.checkMemberRegular(member);
		this.updateTopMember(trackedMember);

		this.data.markDirty();
	}

	private checkMemberRegular (member: GuildMember) {
		const trackedMember = this.getTrackedMember(member.id);
		const shouldBeRegular = trackedMember.xp > this.config.regularMilestoneXp
			|| this.isMod(member);

		if (shouldBeRegular && !member.roles.cache.has(this.config.role)) {
			member.roles.add(this.config.role);
			this.logger.info(`${this.getMemberName(member)} has become a regular!`);
			this.event.emit("becomeRegular", member);
		}
	}

	private updateTopMember (...trackedMembers: ITrackedMember[]) {
		for (const trackedMember of trackedMembers)
			if (!this.topMembers.some(a => a.id == trackedMember.id))
				this.topMembers.push(trackedMember);

		this.topMembers.sort((a, b) => b.xp - a.xp);
	}

	private updateTopMembers () {
		this.topMembers = Object.values(this.members);
		this.topMembers.sort((a, b) => b.xp - a.xp);
	}

	private isMod (member?: GuildMember | null): member is GuildMember {
		return !!member && member.permissions.has("MANAGE_ROLES");
	}

	private doesMemberHaveRegularFromOtherRole (member?: GuildMember | null) {
		return !this.config.rolesWithRegular ? false
			: !!member && this.config.rolesWithRegular.some(role => member.roles.cache.has(role));
	}

	private getCommandName (command: keyof Exclude<IRegularsConfig["commands"], false | undefined>) {
		return (this.config.commands && this.config.commands[command])
			|| baseCommands[command];
	}

	// tslint:disable cyclomatic-complexity
	@Command<RegularsPlugin>(p => p.getCommandName("check"), p => p.config.commands !== false)
	protected async commandCheck (message: CommandMessage, queryMember?: string) {
		let member = message.member;

		if (queryMember) {
			const result = await this.findMember(queryMember);
			if (!result)
				return this.reply(message, `I couldn't find a member matching "${queryMember}"`)
					.then(reply => CommandResult.fail(message, reply));

			if (!(result instanceof GuildMember))
				return Paginator.create(result.values(), this.getXPEmbed(message))
					.reply(message)
					.then(() => CommandResult.pass());

			member = result;
		}

		if (member)
			await this.reply(message, this.getXPEmbed(message)(member));

		return CommandResult.pass();
	}

	private getXPEmbed (message: Message) {
		return (member: GuildMember) => {
			const you = member.id === message.member!.id;
			const memberName = member.displayName;

			if (member.user.bot)
				return new MessageEmbed()
					.setAuthor(memberName, member.user.avatarURL() ?? undefined)
					.setTitle(`${Strings.corrupted(3 + Math.floor(Math.random() * 8))} ${this.getScoreName()}`)
					.addFields(
						{ name: "Days chatted", value: Strings.corrupted(1 + Math.floor(Math.random() * 5)), inline: true },
						{ name: "Streak", value: Strings.corrupted(1 + Math.floor(Math.random() * 5)), inline: true },
						{ name: "Multiplier", value: `${Strings.corrupted(1 + Math.floor(Math.random() * 3))}x`, inline: true },
						{ name: `Days chatted till ${Strings.corrupted(1 + Math.floor(Math.random() * 3))}x multiplier`, value: `${Strings.corrupted(1 + Math.floor(Math.random() * 3))}`, inline: true },
					)
					.setFooter(Random.choice("If you thought you could understand an existence beyond your own, you were wrong.",
						"Bow to me, mortal.",
						">:3c",
						"im powerful",
						"ehehehe~",
						`B E Y O N D ${Strings.NBSP} C O M P R E H E N S I O N`,
						`An incomprehensible amount more ${this.getScoreName()} than the pitiful ${Intl.NumberFormat().format(this.getTrackedMember(message.member!.id).xp ?? 0)} ${this.getScoreName()} that you have.`));

			const pronouns = this.pronouns.referTo(you ? "you" : member);
			const trackedMember = this.members[member.id];
			if (!trackedMember)
				return new MessageEmbed()
					.setAuthor(memberName, member.user.avatarURL() ?? undefined)
					.setTitle(`No ${this.getScoreName()}`)
					.setDescription(Strings.sentence(`${pronouns.they} ${pronouns.are} not currently tracked — either ${pronouns.they} ${pronouns.have} not sent a message or ${pronouns.their} ${this.getScoreName()} decayed below zero.`));

			const days = this.members[member.id].daysVisited;
			const multiplier = this.getMultiplier(days);
			const multiplierFloored = Math.floor(multiplier);
			const daysUntilMultiplierUp = this.xpMultiplierIncreaseDays.get(multiplierFloored + 1)! - days;
			const today = this.getToday();
			const daysAway = today - trackedMember.lastDay;
			const daysTillXpLoss = Math.max(0, this.config.daysBeforeXpLoss - daysAway);

			return new MessageEmbed()
				.setAuthor(memberName, member.user.avatarURL() ?? undefined)
				.setTitle(`${Intl.NumberFormat().format(trackedMember.xp)} ${this.getScoreName()}`)
				.addFields(
					!daysTillXpLoss ? { name: `Losing ${this.getScoreName()}!`, value: `Not chatted for ${daysAway} days` }
						: trackedMember.lastDay < today ? { name: "Not chatted today!", value: Random.choice(...this.config.notChattedMessages ?? ["Come on... say something! We're fun!"]).replace(/\{name\}/g, memberName) } : undefined,
					{ name: "Days chatted", value: `${days}${days === 69 ? " (nice)" : ""}`, inline: true },
					...trackedMember.lastDay < today - 1
						? (!daysTillXpLoss ? [] : [
							{ name: "Days away", value: `${daysAway}`, inline: true },
							{ name: `Days till ${this.getScoreName()} loss`, value: `${daysTillXpLoss}`, inline: true }
						])
						: [
							{ name: "Streak", value: `${trackedMember.streak ?? 0}${trackedMember.streak === 69 ? " (nice)" : ""}`, inline: true },
							{ name: "Multiplier", value: `${Intl.NumberFormat().format(multiplier)}x`, inline: true },
							{ name: `Days chatted till ${multiplierFloored + 1}x multiplier`, value: `${daysUntilMultiplierUp}`, inline: true },
						]);
		};
	}

	@Command<RegularsPlugin>(p => p.getCommandName("rankings"), p => p.config.commands !== false)
	protected commandTop (message: CommandMessage /*, offsetStr: string, quantityStr: string */) {

		const members = this.topMembers
			.map(member => ({
				name: this.getMemberName(member.id),
				value: `${Intl.NumberFormat().format(member.xp)} _(${member.daysVisited} days)_`,
				inline: true,
			}) as Partial<IField>)
			.filter(IField.is)
			.map((field, i) => ({ ...field, name: `${i + 1}. ${field.name}` }));

		Paginator.create(members)
			.setPageHeader(`${this.getScoreName()} Rankings!`)
			.reply(message);

		return CommandResult.pass();
	}

	@Command<RegularsPlugin>(p => p.getCommandName("add"))
	protected async commandAdd (message: CommandMessage, queryMember?: string, amtStr?: string) {
		if (!this.isMod(message.member))
			return CommandResult.pass();

		if (queryMember === undefined || !amtStr)
			return this.reply(message, `you must provide a member to update the ${this.getScoreName()} on and the amount to change the ${this.getScoreName()} by.`)
				.then(reply => CommandResult.fail(message, reply));

		const result = this.validateFindResult(await this.findMember(queryMember));
		if (result.error !== undefined)
			return this.reply(message, result.error)
				.then(reply => CommandResult.fail(message, reply));

		const member = result.member;

		const pronouns = this.pronouns.referTo(member);

		const trackedMember = this.getTrackedMember(member.id);
		const amt = isNaN(+amtStr) ? 0 : +amtStr;
		trackedMember.xp += amt;

		const operation = `${amt > 0 ? "added" : "subtracted"} ${Intl.NumberFormat().format(Math.abs(amt))} ${this.getScoreName()} ${amt > 0 ? "to" : "from"}`;
		const reply = `${operation} ${member.displayName}. ${Strings.sentence(pronouns.their)} new ${this.getScoreName()} is ${Intl.NumberFormat().format(trackedMember.xp)}.`;
		this.reply(message, `I ${reply}`);
		this.logger.info(message.member.displayName, reply);

		this.updateTopMember(trackedMember);
		return CommandResult.pass();
	}

	@Command<RegularsPlugin>(p => p.getCommandName("set"))
	protected async commandSet (message: CommandMessage, queryMember?: string, amtStr?: string) {
		if (!this.isMod(message.member))
			return CommandResult.pass();

		if (queryMember === undefined || !amtStr)
			return this.reply(message, `you must provide a member to update the ${this.getScoreName()} on and the amount to set the ${this.getScoreName()} to.`)
				.then(reply => CommandResult.fail(message, reply));

		const result = this.validateFindResult(await this.findMember(queryMember));
		if (result.error !== undefined)
			return message.reply(result.error)
				.then(reply => CommandResult.fail(message, reply));

		const member = result.member;

		const trackedMember = this.getTrackedMember(member.id);
		const amt = isNaN(+amtStr) ? 0 : +amtStr;
		trackedMember.xp = amt;

		const operation = `set the ${this.getScoreName()} of ${member.displayName} to ${Intl.NumberFormat().format(Math.abs(amt))}`;
		const reply = `${operation}.`;
		this.reply(message, `I ${reply}`);
		this.logger.info(message.member.displayName, reply);

		this.updateTopMember(trackedMember);
		return CommandResult.pass();
	}

	@Command<RegularsPlugin>(p => p.getCommandName("donate"), p => p.config.commands !== false)
	protected async commandDonate (message: CommandMessage, amtStr?: string, queryMember?: string) {
		if (queryMember === undefined)
			return this.reply(message, `you must provide a member to donate ${this.getScoreName()} to.`)
				.then(reply => CommandResult.fail(message, reply));

		const amt = Math.floor(+amtStr!);
		if (isNaN(amt))
			return this.reply(message, `you must provide an amount of ${this.getScoreName()} to donate.`)
				.then(reply => CommandResult.fail(message, reply));

		if (amt < 1)
			return this.reply(message, `you must donate a positive amount of ${this.getScoreName()}. No stealing allowed 😡`)
				.then(reply => CommandResult.fail(message, reply));

		const trackedMember = this.members[message.member?.id!];
		if (!message.member?.roles.cache.has(this.config.role)) {
			this.reply(message, `only regulars can donate ${this.getScoreName()}.`);
			return CommandResult.pass();
		}

		if (trackedMember.xp - this.config.regularMilestoneXp < amt) {
			this.reply(message, `you do not have enough ${this.getScoreName()} to donate ${amt}.`);
			return CommandResult.pass();
		}

		const queryMemberResult = this.validateFindResult(await this.findMember(queryMember));
		if (queryMemberResult.error !== undefined)
			return message.reply(queryMemberResult.error)
				.then(reply => CommandResult.fail(message, reply));

		const member = queryMemberResult.member;

		const updatingMember = this.getTrackedMember(member.id);
		if (!member.roles.cache.has(this.config.role) && !this.isMod(message.member)) {
			this.reply(message, `only mods can donate to non-regular users.`);
			return CommandResult.pass();
		}

		const pronouns = this.pronouns.referTo(member);

		trackedMember.xp -= amt;
		updatingMember.xp += amt;
		this.autoDonate(updatingMember);

		const self = message.member.id === member.id;

		const operation = `donated ${Intl.NumberFormat().format(Math.abs(amt))} ${this.getScoreName()} to ${self ? "yourself" : member.displayName}`;
		const theirNew = `new ${this.getScoreName()} is ${Intl.NumberFormat().format(updatingMember.xp)}`;
		const yourNew = `new ${this.getScoreName()} is ${Intl.NumberFormat().format(trackedMember.xp)}`;
		const result = self ? "In other words, nothing happened." : `${Strings.sentence(pronouns.their)} ${theirNew}. Your ${yourNew}.`;
		this.reply(message, `you ${operation}. ${result}`);

		if (!self)
			this.logger.info(message.member.displayName, `${operation}. ${member.displayName}'s ${theirNew}. ${message.member.displayName}'s ${yourNew}.`);

		this.updateTopMember(trackedMember, updatingMember);
		return CommandResult.pass();
	}

	@Command<RegularsPlugin>(p => p.getCommandName("autodonate"), p => p.config.commands !== false)
	protected async commandAutoDonate (message: CommandMessage, queryMember?: string, amtStr?: string) {
		const trackedMember = this.members[message.member?.id!];
		if (queryMember === undefined) {
			const [donateMemberId, donateMinAmt] = trackedMember.autodonate || [];
			this.reply(message, `${donateMemberId ? `you are currently auto-donating to ${this.getMemberName(donateMemberId)} when your ${this.getScoreName()} exceeds ${Intl.NumberFormat().format(donateMinAmt!)}` : `you must provide a member to donate ${this.getScoreName()} to`}. (Use "remove" or "off" to turn off auto-donation.)`);
			return CommandResult.pass();
		}

		if (queryMember === "remove" || queryMember === "off") {
			delete trackedMember.autodonate;
			this.reply(message, "you have turned off auto-donation.");
			return CommandResult.pass();
		}

		const queryMemberResult = this.validateFindResult(await this.findMember(queryMember));
		if (queryMemberResult.error !== undefined)
			return message.reply(queryMemberResult.error)
				.then(reply => CommandResult.fail(message, reply));

		const member = queryMemberResult.member;

		const updatingMember = this.getTrackedMember(member.id);
		if (!member.roles.cache.has(this.config.role) && !this.isMod(message.member)) {
			this.reply(message, `only mods can donate to non-regular users.`);
			return CommandResult.pass();
		}

		if (trackedMember.id === updatingMember.id) {
			this.reply(message, `You set up auto-donation to yourself. It's almost like nothing happens at all!`);
			return CommandResult.pass();
		}

		const minXp = Math.max(this.config.regularMilestoneXp, Math.floor(+amtStr!) || trackedMember.xp);
		trackedMember.autodonate = [updatingMember.id, minXp];

		const donatedResult = this.autoDonate(trackedMember);
		let result: string | undefined;
		if (donatedResult) {
			const pronouns = this.pronouns.referTo(member);
			const theirNew = `new ${this.getScoreName()} is ${Intl.NumberFormat().format(updatingMember.xp)}`;
			const yourNew = `new ${this.getScoreName()} is ${Intl.NumberFormat().format(trackedMember.xp)}`;
			result = `To start with, you ${donatedResult}. ${Strings.sentence(pronouns.their)} ${theirNew}. Your ${yourNew}.`;
		}

		const operation = `enabled auto-donation to ${member.displayName}${minXp > this.config.regularMilestoneXp ? `, when your ${this.getScoreName()} exceeds ${Intl.NumberFormat().format(minXp)}` : ""}`;

		this.reply(message, `you ${operation}. ${result || ""}`);
		this.logger.info(message.member?.displayName, `${operation}.`);

		this.updateTopMember(trackedMember, updatingMember);
		return CommandResult.pass();
	}
}
