import { Collection, GuildMember, Message, Permissions, RichEmbed, Role } from "discord.js";
import { Command, ImportPlugin } from "../core/Api";
import { Plugin } from "../core/Plugin";
import { RegularsPlugin } from "./RegularsPlugin";


const colorRegex = /#[A-F0-9]{6}/;
function parseColorInput (color: string) {
	color = color.toUpperCase();

	if (color[0] === "#")
		color = color.slice(1);

	if (color.length === 3)
		color = Array.from(color)
			.map(v => `${v}${v}`)
			.join("");

	return `#${color}`;
}

export interface IColorsConfig {
	mustBeRegular: boolean;
	anyColor: boolean;
	aboveRole?: string;
	colors?: { [key: string]: string[] };
}

export class ColorsPlugin extends Plugin<IColorsConfig> {

	@ImportPlugin("regulars")
	private regularsPlugin: RegularsPlugin = undefined!;

	private aboveRole?: Role;

	public getDefaultId () {
		return "colors";
	}

	public async onStart () {
		this.regularsPlugin.onRemoveMember(member => {
			if (!this.config.mustBeRegular)
				return;

			this.removeColor(member);
		});

		this.aboveRole = !this.config.aboveRole ? undefined : this.guild.roles.find(role => role.name === this.config.aboveRole);
		this.removeUnusedColorRoles();
		if (this.config.mustBeRegular)
			this.regularsPlugin.event.subscribe("becomeRegular", async (member: GuildMember) => {
				member.user.send(`
Hey ${this.regularsPlugin.getMemberName(member)}! You have become a regular on ${this.guild.name}.

As a regular, you may now change your username color whenever you please, using the \`!color\` command.
Examples: \`!color f00\` would make your username bright red, \`!color 123456\` would make you a dark blue.
Like any other of my commands, you may use it in the ${this.guild.name} server or in a DM with me.

I will not send any other notification messages, apologies for the interruption.
				`);
			})
	}

	public async getColorRoles (fetch = true) {
		if (fetch)
			await this.guild.fetchMembers();

		return this.guild.roles.filter(r => this.isColorRole(r.name));
	}

	private async removeColor (member: GuildMember, removeUnused = true) {
		const colorRoles = member.roles.filter(r => this.isColorRole(r.name));
		if (!colorRoles.size)
			return;

		this.logger.info("Removing color roles", colorRoles.map(role => role.name).join(", "), "from", member.displayName);
		await member.removeRoles(colorRoles);
		if (removeUnused)
			await this.removeUnusedColorRoles();
	}

	private async removeUnusedColorRoles (colorRoles?: Collection<string, Role>) {
		await this.guild.fetchMembers();
		if (!colorRoles)
			colorRoles = this.guild.roles;

		// we only want to remove the auto-created color roles, the ones in the #COLOR format, and only if they have no members
		colorRoles = colorRoles.filter(r => r.members.size === 0 && colorRegex.test(r.name));
		if (!colorRoles.size)
			return;

		this.logger.info("Removing unused color roles", colorRoles.map(role => role.name).join(", "));
		for (const role of colorRoles.values())
			await role.delete();
	}

	private async getColorRole (color: string) {
		const colorParsed = parseColorInput(color);

		if (this.config.anyColor && colorRegex.test(colorParsed)) {
			color = colorParsed;

		} else if (this.config.colors) {
			const match = Object.entries(this.config.colors)
				.find(([, aliases]) => aliases
					.some(alias => alias.toLowerCase() === color.toLowerCase()));

			if (!match) return undefined;
			color = match[0];
		}

		let colorRole = this.guild.roles.find(role => role.name.toLowerCase() === color.toLowerCase());
		if (!colorRole && colorRegex.test(color)) {
			this.logger.info("Created color role", color);
			colorRole = await this.guild.createRole({
				name: color,
				color,
				position: this.aboveRole && this.aboveRole.position + 1,
				permissions: [],
			});
		}

		return colorRole;
	}

	@Command(["color", "colour"])
	protected async commandColor (message: Message, color?: string, queryMember?: string) {
		if (color === "count") {
			const colors = await this.getColorRoles(true);
			this.reply(message, new RichEmbed()
				.setColor("RANDOM")
				.setDescription(`<@${message.member.id}>, there are currently **${colors.size} colors**, out of ${this.guild.roles.size} roles total.`));
			return true;
		}

		let member = message.member;
		let currentColorRole = member.roles.filter(r => this.isColorRole(r.name)).first();

		let isGetting = color === "get";
		if (!color) {
			if (!currentColorRole) {
				this.reply(message, new RichEmbed()
					.setColor("RANDOM")
					.setDescription(`<@${message.member.id}>, you must provide a valid color.\nNeed help? Examples: ${this.getValidColorExamples()}`));
				return false;
			}

			color = "get";
			isGetting = true;
		}

		if (/list|all/.test(color)) {
			this.reply(message, new RichEmbed()
				.setColor(currentColorRole?.color ?? "RANDOM")
				.setDescription(`<@${message.member.id}>, some examples include: ${this.getValidColorExamples()}`));
			return true;
		}

		if (queryMember) {
			if (!isGetting && !message.member.hasPermission(Permissions.FLAGS.MANAGE_ROLES!)) {
				this.reply(message, new RichEmbed()
					.setColor("RANDOM")
					.setDescription(`<@${message.member.id}>, you must have the 'Manage Roles' permission to change someone else's color.`));
				return false;
			}

			const resultingQueryMember = await this.findMember(queryMember);

			if (!this.validateFindResult(message, resultingQueryMember)) {
				return false;
			}

			member = resultingQueryMember;
			currentColorRole = member.roles.filter(r => this.isColorRole(r.name)).first();
		}

		if (isGetting) {
			if (currentColorRole)
				this.reply(message, new RichEmbed()
					.setColor(currentColorRole.color)
					.setDescription(`<@${message.member.id}>, ${queryMember ? `${member.displayName}'s` : "your"} current color is **${currentColorRole.name}**.\nWant a change? Examples: ${this.getValidColorExamples()}`));

			else
				this.reply(message, new RichEmbed()
					.setColor("RANDOM")
					.setDescription(`<@${message.member.id}>, ${queryMember ? `${member.displayName} does` : "you do"} not currently have a color.${!queryMember ? `\nWant a change? Examples: ${this.getValidColorExamples()}` : ""}`));

			return true;
		}

		if (this.config.mustBeRegular && !this.regularsPlugin.isUserRegular(member)) {
			this.reply(message, new RichEmbed()
				.setColor(currentColorRole?.color ?? "RANDOM")
				.setDescription(`Sorry, <@${message.member.id}>, ${queryMember ? `${member.displayName} is` : "you are"} not a regular of the server. Stick around, chat some more, and ${queryMember ? "they" : "you"}'ll be able to have one soon!`));
			return true;
		}

		const isRemoving = /none|reset|remove/.test(color);

		let colorRole: Role | undefined;
		if (!isRemoving) {
			colorRole = await this.getColorRole(color);
			if (!colorRole) {
				this.reply(message, new RichEmbed()
					.setColor(currentColorRole?.color ?? "RANDOM")
					.setDescription(`<@${message.member.id}>, you must provide a valid color.\nNeed help? Examples: ${this.getValidColorExamples()}`));
				return false;
			}
		}

		await this.removeColor(member, false);

		if (isRemoving) {
			this.reply(message, new RichEmbed()
				.setColor("RANDOM")
				.setDescription(`<@${message.member.id}>, ${queryMember ? `${member.displayName}'s` : "your"} color has been removed. ${currentColorRole ? `(Previously: **${currentColorRole.name}**)` : ""}`));
			return true;
		}

		await member.addRole(colorRole!);
		await this.removeUnusedColorRoles();

		this.reply(message, new RichEmbed()
			.setColor(colorRole!.color)
			.setDescription(`<@${message.member.id}>, ${queryMember ? `${member.displayName}'s` : "your"} color has been changed to **${colorRole!.name}**. ${currentColorRole ? `(Previously: ${currentColorRole.name})` : ""}\nNeed help? Examples: ${this.getValidColorExamples()}`));
		return true;
	}

	private getValidColorExamples () {
		let examples = [];

		if (this.config.anyColor)
			examples.push("`f00` is red", "`123456` is dark blue", "you can use Google's colour picker for more: https://www.google.com/search?q=color+picker");

		if (this.config.colors)
			examples.push(...Object.values(this.config.colors).map(value => value[0]));

		return examples.join(", ");
	}

	private isColorRole (role: string) {
		return colorRegex.test(role) || Object.keys(this.config.colors || {})
			.some(color => color.toLowerCase() === role.toLowerCase());
	}
}
