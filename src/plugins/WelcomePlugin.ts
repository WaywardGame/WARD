import { GuildMember, Role, TextChannel, User } from "discord.js";
import { Command, CommandMessage, CommandResult } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { IInherentPluginData, Plugin } from "../core/Plugin";
import Arrays from "../util/Arrays";
import { sleep } from "../util/Async";
import { minutes, seconds } from "../util/Time";


export interface IWelcomeData extends IInherentPluginData<IWelcomeConfig> {
	welcomedUsers: string[];
}

export interface IWelcomeConfig {
	welcomeChannel?: string | string[];
	welcomeRoles?: string[];
	welcomeMessage?: string | (string | string[])[];
}

enum CommandLanguage {
	WelcomeDescription = "If too many users join at once, the bot pauses in case something happened so that it doesn't spam pings. The following are commands provided in case this occurs.",
	WelcomeConfirmDescription = "This command *confirms* sending welcome messages.",
	WelcomeSkipDescription = "This command *skips* sending welcome messages.",
}

export default class WelcomePlugin extends Plugin<IWelcomeConfig, IWelcomeData> {
	public updateInterval = minutes(1);

	protected initData: () => IWelcomeData = () => ({ welcomedUsers: [] });

	private get channels () {
		return Arrays.or(this.config.welcomeChannel ?? [])
			.map(channel => this.guild.channels.cache.get(channel) as TextChannel);
	}

	private isWelcoming = false;
	private get welcomedUsers () { return this.data.welcomedUsers; }
	private continueWelcomes?: (report: boolean) => any;

	public getDefaultId () {
		return "welcome";
	}

	public getDescription () {
		return "A plugin for welcoming new users (when they've gotten specific roles).";
	}

	public isHelpVisible (author: User) {
		return this.guild.members.cache.get(author.id)
			?.permissions.has("ADMINISTRATOR")
			?? false;
	}

	private readonly help = new HelpContainerPlugin()
		.setDescription(CommandLanguage.WelcomeDescription)
		.addCommand("welcome confirm", CommandLanguage.WelcomeConfirmDescription)
		.addCommand("welcome skip", CommandLanguage.WelcomeSkipDescription);

	@Command(["help welcome", "welcome help"])
	protected async commandHelp (message: CommandMessage) {
		if (!message.member?.permissions.has("ADMINISTRATOR"))
			return CommandResult.pass();

		this.reply(message, this.help);
		return CommandResult.pass();
	}

	public async onUpdate () {
		if (this.isWelcoming) {
			return;
		}

		this.isWelcoming = true;
		await this.welcomeNewUsers();

		this.isWelcoming = false;
	}

	@Command<WelcomePlugin>("welcome confirm")
	protected confirmWelcome (message: CommandMessage) {
		this.continueLogging(message, true);
		return CommandResult.pass();
	}

	@Command<WelcomePlugin>("welcome skip")
	protected skipWelcome (message: CommandMessage) {
		this.continueLogging(message, false);
		return CommandResult.pass();
	}

	private async getWelcomeRoles () {
		return Promise.all((this.config.welcomeRoles ?? []).map(role => this.findRole(role)))
			.then(roles => roles.filter((role): role is Role => !!role));
	}

	private continueLogging (message: CommandMessage, report: boolean) {
		if (!message.member?.permissions.has("ADMINISTRATOR"))
			return;

		if (!this.continueWelcomes) {
			this.reply(message, `No welcomes to ${report ? "confirm" : "skip"}.`);
			return;
		}

		this.reply(message, `Welcomes ${report ? "confirmed" : "skipped"}.`);
		this.logger.info(`Welcomes ${report ? "confirmed" : "skipped"} by ${message.member.displayName}.`);

		this.continueWelcomes?.(report);
		delete this.continueWelcomes;
	}

	private async welcomeNewUsers () {
		await this.guild.members.fetch({ force: true }).catch(err => this.logger.warning(err.stack));

		const welcomeRoles = await this.getWelcomeRoles();
		// each guild member that has a welcome role
		const users = this.guild.members.cache.filter(member =>
			welcomeRoles.some(role => member.roles.cache.has(role.id))
			&& !this.welcomedUsers.includes(member.id));

		if (!users?.size)
			return;

		let welcome = true;
		if (users.size > 10 && !this.continueWelcomes) {
			this.logger.warning(`Trying to welcome ${users.size} users. To proceed send command !welcome confirm, to skip send !welcome skip`);
			welcome = await new Promise<boolean>(resolve => this.continueWelcomes = resolve);
		}

		users.sort((a, b) => (a.joinedAt?.getTime() || 0) - (b.joinedAt?.getTime() || 0));

		for (const [, user] of users)
			await this.handleJoin(user, welcome);

		this.data.markDirty();
	}

	private async handleJoin (user: GuildMember, welcome: boolean) {
		this.welcomedUsers.push(user.id);
		await this.save();

		this.logger.info(`${welcome ? "Welcoming" : "Skipping welcome for"}: ${user.displayName}`);

		if (welcome && this.config.welcomeMessage !== undefined) {
			const message = (Array.isArray(this.config.welcomeMessage) ? this.config.welcomeMessage : [this.config.welcomeMessage])
				.map(part => Array.isArray(part) ? part[Math.floor(Math.random() * part.length)] : part)
				.join(" ")
				.replace("{user}", `<@${user.id}>`);

			for (const channel of this.channels) {
				await channel.send(message);
				await sleep(seconds(1));
			}

			await sleep(seconds(4));
		}
	}
}
