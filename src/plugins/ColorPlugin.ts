import { Collection, GuildMember, Message, Role, Permissions, RichEmbed } from "discord.js";

import { Plugin } from "../core/Plugin";
import { sleep } from "../util/Async";
import { ImportPlugin } from "../core/Api";
import { RegularsPlugin } from "./RegularsPlugin";

const colorRegex = /#[A-F0-9]{6}/;
function parseColorInput (color: string) {
	if (!color.startsWith("#")) {
		return color;
	}

	if (color.length === 4) {
		color = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
	}

	return color.toUpperCase();
}

export interface IColorsConfig {
	mustBeRegular: boolean;
	anyColor: boolean;
	aboveRole?: string;
	colors?: { [key: string]: string[] };
}

export class ColorsPlugin extends Plugin<IColorsConfig> {

	@ImportPlugin("regulars")
	private regularsPlugin: RegularsPlugin = undefined;

	private aboveRole?: Role;

	public getDefaultId () {
		return "colors";
	}

	public async onStart () {
		this.regularsPlugin.onRemoveMember(this.removeColor.bind(this));
		this.aboveRole = !this.config.aboveRole ? undefined : this.guild.roles.find(role => role.name === this.config.aboveRole);
		this.removeUnusedColorRoles();
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		switch (command) {
			case "color": return this.commandColor(message, args[0], args[1]);
		}
	}

	private async removeColor (member: GuildMember) {
		const colorRoles = member.roles.filter(r => this.isColorRole(r.name));
		await member.removeRoles(colorRoles);
		this.removeUnusedColorRoles(colorRoles);
	}

	private async removeUnusedColorRoles (colorRoles?: Collection<string, Role>) {
		if (colorRoles) {
			await sleep(10000);

		} else {
			colorRoles = this.guild.roles;
		}

		// we only want to remove the auto-created color roles, the ones in the #COLOR format
		colorRoles = colorRoles.filter(r => colorRegex.test(r.name));

		for (const role of colorRoles.values()) {
			if (role.members.size === 0) {
				await role.delete();
			}
		}
	}

	private async getColorRole (color: string) {
		if (this.config.anyColor && colorRegex.test(color)) {

		} else if (this.config.colors) {
			const match = Object.entries(this.config.colors).find(([, aliases]) => aliases.some(alias => alias.toLowerCase() === color.toLowerCase()));
			if (!match) return undefined;
			color = match[0];
		}

		let colorRole = this.guild.roles.find(role => role.name.toLowerCase() === color.toLowerCase());
		if (!colorRole && colorRegex.test(color)) {
			colorRole = await this.guild.createRole({
				name: color,
				color,
				position: this.aboveRole && this.aboveRole.position + 1,
			});
		}

		return colorRole;
	}

	private async commandColor (message: Message, color?: string, queryMember?: string) {
		if (!color) {
			this.reply(message, `you must provide a valid color. Examples: ${this.getValidColorExamples()}`);
			return;
		}

		if (/list|all/.test(color)) {
			this.reply(message, `${this.getValidColorExamples()}`);
			return;
		}

		let member = message.member;

		if (queryMember) {
			if (!message.member.hasPermission(Permissions.FLAGS.MANAGE_ROLES)) {
				this.reply(message, "you must have the 'Manage Roles' permission to change someone else's color.");
				return;
			}

			const resultingQueryMember = await this.findMember(queryMember);

			if (!this.validateFindResult(message, resultingQueryMember)) {
				return;
			}

			member = resultingQueryMember;

		} else {
			if (this.config.mustBeRegular && !this.regularsPlugin.isUserRegular(message.member)) {
				this.reply(message, "sorry, but you must be a regular of the server to change your color.");
				return;
			}
		}

		const isRemoving = /none|reset|remove/.test(color);

		color = parseColorInput(color);

		let colorRole: Role | undefined;
		if (!isRemoving) {
			colorRole = await this.getColorRole(color);
			if (!colorRole) {
				this.reply(message, `you must provide a valid color. Examples: ${this.getValidColorExamples()}`);
				return;
			}
		}

		await this.removeColor(member);

		if (isRemoving) {
			return;
		}

		await member.addRole(colorRole!);

		this.reply(message, new RichEmbed()
			.setColor(colorRole.color)
			.setDescription(`<@${message.member.id}>, ${queryMember ? `${member.displayName}'s` : "your"} color has been changed to **${colorRole.name}**.`));
	}

	private getValidColorExamples () {
		let examples = [];

		if (this.config.anyColor)
			examples.push("`f00` is red", "`123456` is dark blue");

		if (this.config.colors)
			examples.push(...Object.values(this.config.colors).map(value => value[0]));

		return examples.join(", ");
	}

	private isColorRole (role: string) {
		return colorRegex.test(role) || Object.keys(this.config.colors || {})
			.some(color => color.toLowerCase() === role.toLowerCase());
	}
}
