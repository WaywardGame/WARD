import { Collection, Message, Permissions } from "discord.js";
import { Command } from "../core/Api";
import { Plugin } from "../core/Plugin";


export interface IRoleTogglePluginConfig {
	toggleableRoles: { [key: string]: string[] };
}

export class RoleTogglePlugin extends Plugin<IRoleTogglePluginConfig> {

	public getDefaultId () {
		return "roleToggle";
	}

	// tslint:disable cyclomatic-complexity
	@Command("role")
	protected async commandRole (message: Message, roleName?: string, queryMember?: string) {
		if (!roleName) {
			this.reply(message, "you must provide a role to toggle.");
			return;
		}

		roleName = roleName.toLowerCase();

		const role = this.guild.roles.find(r => {
			const pingRole = r.name.toLowerCase();
			if (Object.entries(this.config.toggleableRoles).some(([toggleableRole, aliases]) => pingRole === toggleableRole.toLowerCase() && aliases.some(alias => alias === roleName))) {
				return true;
			}
		});

		if (!role) {
			this.reply(message, `sorry, I couldn't find a toggleable role by the name "${roleName}".`);
			return;
		}

		let toggleMember = message.member;
		if (queryMember) {
			if (!message.member.permissions.has(Permissions.FLAGS.MANAGE_ROLES)) {
				this.reply(message, "only mods can toggle the roles of other members.");
				return;
			}

			const resultingQueryMember = await this.findMember(queryMember);

			if (resultingQueryMember instanceof Collection) {
				this.reply(message, "I found multiple members with that name. Can you be more specific?");
				return;

			} else if (!resultingQueryMember) {
				this.reply(message, "I couldn't find a member by that name.");
				return;
			}

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
	}
}
