import { Channel, GuildMember, MessageEmbed, Permissions } from "discord.js";
import { Command, CommandMessage, CommandResult, RoleMatcher } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Plugin } from "../core/Plugin";
import Arrays, { tuple } from "../util/Arrays";
import { COLOR_BAD, COLOR_GOOD, COLOR_WARNING } from "../util/Colors";

interface IToggleableRoles {
	unaliasRoleName?: true;
	aliases: ArrayOr<string>;
	rules?: ArrayOr<string> | { not: ArrayOr<string> };
}

type ToggleableRoles = ArrayOr<string> | IToggleableRoles;

export interface IRoleTogglePluginConfig {
	toggleableRoles: Record<string, ToggleableRoles>;
}

enum CommandLanguage {
	RoleDescription = "Toggles whether you or another user has a role.",
	RoleArgumentRole = "The role to toggle.",
	RoleArgumentUser = "_(Requires manage roles permission.)_ You can specify an ID, a username & tag, and a display name. If provided, toggles the role for the user specified. If not provided, toggles the role for yourself.",
}

export class RoleTogglePlugin extends Plugin<IRoleTogglePluginConfig> {

	protected initData: undefined;

	public getDefaultId () {
		return "roleToggle";
	}

	public getDescription () {
		return "A plugin for toggling roles on server members.";
	}

	private readonly help = (channel?: Channel) => new HelpContainerPlugin()
		.addCommand("role", CommandLanguage.RoleDescription, command => command
			.addRawTextArgument("role", CommandLanguage.RoleArgumentRole, argument => argument
				.addOptions(...Object.entries(this.config.toggleableRoles)
					.map(([role, config]) => tuple(
						[...this.getAliases(role, config)]
							.map(alias => alias.includes(" ") ? `"${alias}"` : alias)
							.join("|"),
						`Adds the role ${this.mentionRole(this.findRole(role, false)!, channel)}`))))
			.addArgument("user", CommandLanguage.RoleArgumentUser, argument => argument
				.setOptional()));

	@Command(["help role", "role help"])
	protected async commandHelp (message: CommandMessage) {
		this.reply(message, this.help(message.channel));
		return CommandResult.pass();
	}

	// tslint:disable cyclomatic-complexity
	@Command("role")
	protected async commandRole (message: CommandMessage, roleName?: string, queryMember?: string) {
		if (!roleName)
			return this.reply(message, new MessageEmbed()
				.setColor(COLOR_WARNING)
				.setDescription(`Please provide a role to toggle. Use \`${this.commandPrefix}help role\` for a list of toggleable roles.`))
				.then(reply => CommandResult.fail(message, reply));

		////////////////////////////////////
		// Resolve the member to toggle a role of
		//

		let toggleMember = message.member!;
		if (queryMember) {
			if (!message.member?.permissions.has(Permissions.FLAGS.MANAGE_ROLES!)) {
				this.reply(message, new MessageEmbed()
					.setColor(COLOR_WARNING)
					.setDescription("Only mods can toggle the roles of other members."));
				return CommandResult.pass();
			}

			const queryMemberResult = this.validateFindResult(await this.findMember(queryMember));
			if (queryMemberResult.error !== undefined)
				return this.reply(message, queryMemberResult.error)
					.then(reply => CommandResult.fail(message, reply));

			toggleMember = queryMemberResult.member;
		}

		////////////////////////////////////
		// Resolve the role to toggle
		//

		const role = this.findToggleRole(roleName, toggleMember);
		if (!role)
			return this.reply(message, new MessageEmbed()
				.setColor(COLOR_BAD)
				.setDescription(`No toggleable role found with query \`${roleName}\`.`))
				.then(reply => CommandResult.fail(message, reply));

		if (toggleMember.roles.cache.has(role.id)) {
			toggleMember.roles.remove(role);
			this.logger.info(`Removed role ${role.name} from ${toggleMember.displayName}`);
			this.reply(message, new MessageEmbed()
				.setColor(COLOR_BAD)
				.setDescription(`Removed role <@&${role.id}>${toggleMember === message.member ? "" : ` from <@${toggleMember.id}>`}!`));

		} else {
			toggleMember.roles.add(role);
			this.logger.info(`Added role ${role.name} to ${toggleMember.displayName}`);
			this.reply(message, new MessageEmbed()
				.setColor(COLOR_GOOD)
				.setDescription(`Added role <@&${role.id}>${toggleMember === message.member ? "" : ` to <@${toggleMember.id}>`}!`));
		}

		return CommandResult.pass();
	}

	private findToggleRole (query: string, member: GuildMember) {
		query = query.toLowerCase();
		let role = this.guild.roles.cache.get(query);
		if (role)
			return role;

		// find toggleableRoles that match the query
		for (const [toggleableRole, config] of Object.entries(this.config.toggleableRoles)) {
			if (!this.getAliases(toggleableRole, config).has(query))
				continue;

			const rules = this.getRules(config);
			if (rules) {
				if (!new RoleMatcher(rules).matchesRoles(member.roles.cache))
					continue;
			}

			return this.findRole(toggleableRole, false);
		}

		return undefined;
	}

	private getRules (config: ToggleableRoles) {
		if (typeof config === "object" && !Array.isArray(config))
			return config.rules;

		return undefined;
	}

	private getAliases (roleQuery: string, config: ToggleableRoles) {
		let unaliasRoleName = false;
		if (typeof config === "object" && "aliases" in config) {
			unaliasRoleName = config.unaliasRoleName ?? false;
			config = config.aliases;
		}

		const aliases = new Set(Arrays.or(config));
		if (!unaliasRoleName) { // the name of the role should be included as an alias for adding the role
			const role = this.findRole(roleQuery, false);
			if (role) aliases.add(role.name);
		}

		return aliases;
	}
}
