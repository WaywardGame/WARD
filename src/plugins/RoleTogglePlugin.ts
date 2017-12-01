import { Collection, Message, Role } from "discord.js";

import { Plugin } from "../core/Plugin";

export interface IRoleTogglePluginConfig {
	toggleableRoles: { [key: string]: string[] };
}

export class RoleTogglePlugin extends Plugin<IRoleTogglePluginConfig> {
	private roleMod: Role;

	public getDefaultId () {
		return "roleToggle";
	}

	public onStart () {
		this.roleMod = this.guild.roles.find("name", "mod");
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		switch (command) {
			case "role": return this.commandRole(message, args[0], args[1]);
		}
	}

	// tslint:disable cyclomatic-complexity
	private commandRole (message: Message, roleName?: string, queryMember?: string) {
		if (!roleName) {
			this.reply(message, "you must provide a role to toggle.");
			return;
		}

		const role = this.guild.roles.find(r => {
			const pingRole = r.name.toLowerCase();
			if (this.config.toggleableRoles[pingRole] && this.config.toggleableRoles[pingRole].includes(roleName)) {
				return true;
			}
		});

		if (!role) {
			this.reply(message, `sorry, I couldn't find a toggleable role by the name "${roleName}".`);
			return;
		}

		let toggleMember = message.member;
		if (queryMember) {
			if (!message.member.roles.has(this.roleMod.id)) {
				this.reply(message, "only mods can toggle the roles of other members.");
				return;
			}

			const resultingQueryMember = this.findMember(queryMember);

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

		} else {
			toggleMember.addRole(role);
		}
	}
}
