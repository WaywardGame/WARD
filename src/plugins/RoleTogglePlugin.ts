import { Message } from "discord.js";

import { Plugin } from "../Plugin";

export interface IRoleTogglePluginConfig {
	toggleableRoles: { [key: string]: string[] };
}

export class RoleTogglePlugin extends Plugin<any, IRoleTogglePluginConfig> {

	public getDefaultId () {
		return "roleToggle";
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		switch (command) {
			case "role": return this.commandRole(message, args[0]);
		}
	}

	private commandRole (message: Message, roleName: string) {
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

		if (message.member.roles.has(role.id)) {
			message.member.removeRole(role);

		} else {
			message.member.addRole(role);
		}
	}
}
