import { Message } from "discord.js";

import { Plugin } from "../Plugin";

export interface IRoleTogglePluginConfig {
	pingRoles: { [key: string]: string[] };
}

export class RoleTogglePlugin extends Plugin<any, IRoleTogglePluginConfig> {

	public getDefaultId () {
		return "waywardPing";
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		switch (command) {
			case "role": return this.commandRole(message, args[0]);
		}
	}

	private commandRole (message: Message, roleName: string) {
		const role = this.guild.roles.find(r => {
			const pingRole = r.name.toLowerCase();
			if (this.config.pingRoles[pingRole] && this.config.pingRoles[pingRole].includes(roleName)) {
				return true;
			}
		});

		if (!role) {
			this.reply(message, `sorry, I couldn't find a role by the name ${roleName}.`);

			return;
		}

		if (message.member.roles.has(role.id)) {
			message.member.removeRole(role);

		} else {
			message.member.addRole(role);
		}
	}
}
