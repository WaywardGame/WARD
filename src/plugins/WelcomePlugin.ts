import { GuildMember, Message, Role, TextChannel, User } from "discord.js";
import { Command } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Plugin } from "../core/Plugin";
import { sleep } from "../util/Async";
import { minutes, seconds } from "../util/Time";


export interface IWelcomeData {
	welcomedUsers: string[];
}

export interface IWelcomeConfig {
	welcomeChannel: string;
	welcomeRoles: string[];
	welcomeMessage: string | (string | string[])[];
}

enum CommandLanguage {
	WelcomeDescription = "If too many users join at once, the bot pauses in case something happened so that it doesn't spam pings. The following are commands provided in case this occurs.",
	WelcomeConfirmDescription = "This command *confirms* sending welcome messages.",
	WelcomeSkipDescription = "This command *skips* sending welcome messages.",
}

export default class WelcomePlugin extends Plugin<IWelcomeConfig, IWelcomeData> {
	public updateInterval = minutes(1);

	private channel: TextChannel;
	private welcomeRoles: Role[];
	private isWelcoming = false;
	private welcomedUsers: string[];
	private continueWelcomes?: (report: boolean) => any;

	public getDefaultId () {
		return "welcome";
	}

	public getDescription () {
		return "A plugin for welcoming new users (when they've gotten specific roles).";
	}

	public isHelpVisible (author: User) {
		return this.guild.members.get(author.id)
			?.permissions.has("ADMINISTRATOR")
			?? false;
	}

	private readonly help = new HelpContainerPlugin()
		.setDescription(CommandLanguage.WelcomeDescription)
		.addCommand("welcome confirm", CommandLanguage.WelcomeConfirmDescription)
		.addCommand("welcome skip", CommandLanguage.WelcomeSkipDescription);

	@Command(["help welcome", "welcome help"])
	protected async commandHelp (message: Message) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
			return true;

		this.reply(message, this.help);
		return true;
	}

	public async onStart () {
		this.welcomedUsers = this.getData("welcomedUsers", []);
		this.welcomeRoles = (await Promise.all(this.config.welcomeRoles.map(role => this.findRole(role))))
			.filter((role): role is Role => !!role);
	}

	public async onUpdate () {
		if (this.isWelcoming) {
			return;
		}

		this.channel = this.guild.channels.find(channel => channel.id === this.config.welcomeChannel) as TextChannel;

		this.isWelcoming = true;
		await this.welcomeNewUsers();

		this.isWelcoming = false;

		this.save();
	}

	@Command<WelcomePlugin>("welcome confirm")
	protected confirmWelcome (message: Message) {
		this.continueLogging(message, true);
		return true;
	}

	@Command<WelcomePlugin>("welcome skip")
	protected skipWelcome (message: Message) {
		this.continueLogging(message, false);
		return true;
	}

	private continueLogging (message: Message, report: boolean) {
		if (!message.member.permissions.has("ADMINISTRATOR"))
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
		await this.guild.fetchMembers();

		// each guild member that has a welcome role
		const users = this.guild.members.filter(member =>
			this.welcomeRoles.some(role => member.roles.has(role.id))
			&& !this.welcomedUsers.includes(member.id));

		if (!users?.size)
			return;

		let welcome = true;
		if (users.size > 10 && !this.continueWelcomes) {
			this.logger.warning(`Trying to welcome ${users.size} users. To proceed send command !welcome confirm, to skip send !welcome skip`);
			welcome = await new Promise<boolean>(resolve => this.continueWelcomes = resolve);
		}

		users.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

		for (const [, user] of users)
			await this.handleJoin(user, welcome);
	}

	private async handleJoin (user: GuildMember, welcome: boolean) {
		this.welcomedUsers.push(user.id);
		await this.save();

		this.logger.info(`${welcome ? "Welcoming" : "Skipping welcome for"}: ${user.displayName}`);

		if (welcome) {
			this.channel.send((Array.isArray(this.config.welcomeMessage) ? this.config.welcomeMessage : [this.config.welcomeMessage])
				.map(part => Array.isArray(part) ? part[Math.floor(Math.random() * part.length)] : part)
				.join(" ")
				.replace("{user}", `<@${user.id}>`));

			await sleep(seconds(5));
		}
	}
}
