import { Message, Permissions } from "discord.js";
import { Command } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Plugin } from "../core/Plugin";


export interface IRoleTogglePluginConfig {
	toggleableRoles: { [key: string]: string[] };
}

enum CommandLanguage {
	RoleDescription = "Toggles whether you or another user has a role.",
	RoleArgumentRole = "The role to toggle.",
	RoleArgumentUser = "_(Requires manage roles permission.)_ You can specify an ID, a username & tag, and a display name. If provided, toggles the role for the user specified. If not provided, toggles the role for yourself.",
}

export class RoleTogglePlugin extends Plugin<IRoleTogglePluginConfig> {

	public getDefaultId () {
		return "roleToggle";
	}

	public getDescription () {
		return "A plugin for toggling roles on server members.";
	}

	private readonly help = new HelpContainerPlugin()
		.addCommand("role", CommandLanguage.RoleDescription, command => command
			.addArgument("role", CommandLanguage.RoleArgumentRole)
			.addArgument("user", CommandLanguage.RoleArgumentUser, argument => argument
				.setOptional()));

	@Command(["help role", "role help"])
	protected async commandHelp (message: Message) {
		this.reply(message, this.help);
		return true;
	}

	// tslint:disable cyclomatic-complexity
	@Command("role")
	protected async commandRole (message: Message, roleName?: string, queryMember?: string) {
		if (!roleName) {
			this.reply(message, "you must provide a role to toggle.");
			return false;
		}

		roleName = roleName.toLowerCase();

		const role = this.guild.roles.find(r => {
			const pingRole = r.name.toLowerCase();
			return Object.entries(this.config.toggleableRoles)
				.some(([toggleableRole, aliases]) => pingRole === toggleableRole.toLowerCase() && aliases.some(alias => alias === roleName));
		});

		if (!role) {
			this.reply(message, `sorry, I couldn't find a toggleable role by the name "${roleName}".`);
			return false;
		}

		let toggleMember = message.member;
		if (queryMember) {
			if (!message.member.permissions.has(Permissions.FLAGS.MANAGE_ROLES!)) {
				this.reply(message, "only mods can toggle the roles of other members.");
				return true;
			}

			const resultingQueryMember = await this.findMember(queryMember);
			if (!this.validateFindResult(message, resultingQueryMember))
				return false;

			toggleMember = resultingQueryMember;
		}

		if (toggleMember.roles.has(role.id)) {
			toggleMember.removeRole(role);
			this.logger.info(`Removed role ${role.name} from ${toggleMember.displayName}`);
			this.reply(message, toggleMember === message.member ? `you no longer have the role "${role.name}".` : `Removed role "${role.name}" from ${toggleMember.displayName}.`);

		} else {
			toggleMember.addRole(role);
			this.logger.info(`Added role ${role.name} to ${toggleMember.displayName}`);
			this.reply(message, toggleMember === message.member ? `you have been given the role "${role.name}".` : `Added role "${role.name}" to ${toggleMember.displayName}.`);
		}

		return true;
	}
}
