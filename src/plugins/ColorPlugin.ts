import { Collection, GuildMember, MessageEmbed, Permissions, Role } from "discord.js";
import { Command, CommandMessage, CommandResult, ImportPlugin } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
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

enum CommandLanguage {
	ColorDescription = "Prints your current colour.",
	ColorCountDescription = "Counts how many colour roles there currently are, compared to roles in general.",
	ColorListDescription = "Prints a guide to valid colours.",
	ColorRemoveDescription = "Removes your colour.",
	ColorGetDescription = "Prints your current colour, or the current colour of another user.",
	ColorGetArgumentUser = "You can specify an ID, a username & tag, and a display name. If provided, gets the colour of the user specified. If not provided, gets your own colour.",
	ColorSetDescription = "Sets your colour, or the colour of another user.",
	ColorSetArgumentColor = "If the server has a list of valid colours, use one of those. If the server allows any colour, use a hex string, for example `#ff0000`. Using a `#` is optional. Follows CSS color syntax, so `#007` expands to `#000077`. Google's color picker can be used if you need to find a specific colour: https://www.google.com/search?q=color+picker",
	ColorSetArgumentUser = "_(Requires manage roles permission.)_ You can specify an ID, a username & tag, and a display name. If provided, sets the colour of the user specified. If not provided, sets your own colour.",
}

export class ColorsPlugin extends Plugin<IColorsConfig> {

	@ImportPlugin("regulars")
	private regularsPlugin: RegularsPlugin = undefined!;

	private get aboveRole () { return this.config.aboveRole && this.guild.roles.cache.get(this.config.aboveRole); }

	protected initData: undefined;

	public getDefaultId () {
		return "colors";
	}

	public getDescription () {
		return "A plugin for managing your own colour and the colour of other members.";
	}

	private readonly help = new HelpContainerPlugin()
		.addCommand("color|colour", CommandLanguage.ColorDescription)
		.addCommand("color|colour", CommandLanguage.ColorSetDescription, command => command
			.addArgument("color", CommandLanguage.ColorSetArgumentColor)
			.addArgument("user", CommandLanguage.ColorSetArgumentUser, argument => argument
				.setOptional()))
		.addCommand("color|colour reset|remove|none", CommandLanguage.ColorRemoveDescription)
		.addCommand("color|colour list|all", CommandLanguage.ColorListDescription)
		.addCommand("color|colour get", CommandLanguage.ColorGetDescription, command => command
			.addArgument("user", CommandLanguage.ColorGetArgumentUser, argument => argument
				.setOptional()))
		.addCommand("color|colour count", CommandLanguage.ColorCountDescription);

	@Command(["help color", "color help", "colour help"])
	protected async commandHelp (message: CommandMessage) {
		this.reply(message, this.help);
		return CommandResult.pass();
	}

	public async onStart () {
		this.regularsPlugin.onRemoveMember(member => {
			if (!this.config.mustBeRegular)
				return;

			this.removeColor(member);
		});

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
			await this.guild.members.fetch({ force: true });

		return this.guild.roles.cache.filter(r => this.isColorRole(r.name));
	}

	private async removeColor (member: GuildMember, removeUnused = true) {
		const colorRoles = member.roles.cache.filter(r => this.isColorRole(r.name));
		if (!colorRoles.size)
			return;

		this.logger.info("Removing color roles", colorRoles.map(role => role.name).join(", "), "from", member.displayName);
		await member.roles.remove(colorRoles);
		if (removeUnused)
			await this.removeUnusedColorRoles();
	}

	private async removeUnusedColorRoles (colorRoles?: Collection<string, Role>) {
		await this.guild.roles.fetch(undefined, undefined, true);
		await this.guild.members.fetch({ force: true });
		if (!colorRoles)
			colorRoles = this.guild.roles.cache;

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

		let colorRole = this.guild.roles.cache.find(role => role.name.toLowerCase() === color.toLowerCase());
		if (!colorRole && colorRegex.test(color)) {
			this.logger.info("Created color role", color);
			colorRole = await this.guild.roles.create({
				data: {
					name: color,
					color,
					position: this.aboveRole && this.aboveRole.position + 1 || undefined,
					permissions: [],
				},
			});
		}

		return colorRole;
	}

	@Command(["color", "colour"])
	protected async commandColor (message: CommandMessage, color?: string, queryMember?: string) {
		if (color === "count") {
			const colors = await this.getColorRoles(true);
			this.reply(message, new MessageEmbed()
				.setColor("RANDOM")
				.setDescription(`<@${message.member?.id}>, there are currently **${colors.size} colors**, out of ${this.guild.roles.cache.size} roles total.`));
			return CommandResult.pass();
		}

		let member = message.member;
		let currentColorRole = member?.roles.cache.filter(r => this.isColorRole(r.name)).first();

		let isGetting = color === "get";
		if (!color) {
			if (!currentColorRole) {
				return this.reply(message, new MessageEmbed()
					.setColor("RANDOM")
					.setDescription(`<@${message.member?.id}>, you must provide a valid color.\nNeed help? Examples: ${this.getValidColorExamples()}`))
					.then(reply => CommandResult.fail(message, reply));
			}

			color = "get";
			isGetting = true;
		}

		if (/list|all/.test(color)) {
			this.reply(message, new MessageEmbed()
				.setColor(currentColorRole?.color ?? "RANDOM")
				.setDescription(`<@${message.member?.id}>, some examples include: ${this.getValidColorExamples()}`));
			return CommandResult.pass();
		}

		if (queryMember) {
			if (!isGetting && !message.member?.hasPermission(Permissions.FLAGS.MANAGE_ROLES!)) {
				return this.reply(message, new MessageEmbed()
					.setColor("RANDOM")
					.setDescription(`<@${message.member?.id}>, you must have the 'Manage Roles' permission to change someone else's color.`))
					.then(reply => CommandResult.fail(message, reply));
			}

			const result = this.validateFindResult(await this.findMember(queryMember));
			if (result.error !== undefined)
				return this.reply(message, result.error)
					.then(reply => CommandResult.fail(message, reply));

			member = result.member;
			currentColorRole = member.roles.cache.filter(r => this.isColorRole(r.name)).first();
		}

		if (!member)
			return CommandResult.pass();

		if (isGetting) {
			if (currentColorRole)
				this.reply(message, new MessageEmbed()
					.setColor(currentColorRole.color)
					.setDescription(`<@${message.member?.id}>, ${queryMember ? `${member?.displayName}'s` : "your"} current color is **${currentColorRole.name}**.\nWant a change? Examples: ${this.getValidColorExamples()}`));

			else
				this.reply(message, new MessageEmbed()
					.setColor("RANDOM")
					.setDescription(`<@${message.member?.id}>, ${queryMember ? `${member?.displayName} does` : "you do"} not currently have a color.${!queryMember ? `\nWant a change? Examples: ${this.getValidColorExamples()}` : ""}`));

			return CommandResult.pass();
		}

		if (this.config.mustBeRegular && !this.regularsPlugin.isUserRegular(member)) {
			this.reply(message, new MessageEmbed()
				.setColor(currentColorRole?.color ?? "RANDOM")
				.setDescription(`Sorry, <@${message.member?.id}>, ${queryMember ? `${member.displayName} is` : "you are"} not a regular of the server. Stick around, chat some more, and ${queryMember ? "they" : "you"}'ll be able to have one soon!`));
			return CommandResult.pass();
		}

		const isRemoving = /none|reset|remove/.test(color);

		let colorRole: Role | undefined;
		if (!isRemoving) {
			colorRole = await this.getColorRole(color);
			if (!colorRole) {
				return this.reply(message, new MessageEmbed()
					.setColor(currentColorRole?.color ?? "RANDOM")
					.setDescription(`<@${message.member?.id}>, you must provide a valid color.\nNeed help? Examples: ${this.getValidColorExamples()}`))
					.then(reply => CommandResult.fail(message, reply));
			}
		}

		await this.removeColor(member, false);

		if (isRemoving) {
			this.reply(message, new MessageEmbed()
				.setColor("RANDOM")
				.setDescription(`<@${message.member?.id}>, ${queryMember ? `${member.displayName}'s` : "your"} color has been removed. ${currentColorRole ? `(Previously: **${currentColorRole.name}**)` : ""}`));
			return CommandResult.pass();
		}

		await member.roles.add(colorRole!);
		await this.removeUnusedColorRoles();

		this.reply(message, new MessageEmbed()
			.setColor(colorRole!.color)
			.setDescription(`<@${message.member?.id}>, ${queryMember ? `${member.displayName}'s` : "your"} color has been changed to **${colorRole!.name}**. ${currentColorRole ? `(Previously: ${currentColorRole.name})` : ""}\nNeed help? Examples: ${this.getValidColorExamples()}`));
		return CommandResult.pass();
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
