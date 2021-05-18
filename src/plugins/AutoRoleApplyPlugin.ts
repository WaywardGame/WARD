import { Role } from "discord.js";
import { RoleMatcher } from "../core/Api";
import { Plugin } from "../core/Plugin";
import Arrays from "../util/Arrays";
import { minutes } from "../util/Time";

export interface IAutoRoleConfig {
	rules: IAutoRoleRuleConfig[];
}

interface IAutoRoleRuleConfig {
	match: ArrayOr<string>;
	apply?: ArrayOr<string>;
	remove?: ArrayOr<string>;
}

interface IAutoRoleRule {
	match: RoleMatcher;
	apply: Role[];
	remove: Role[];
}

export default class AutoRolePlugin extends Plugin<IAutoRoleConfig> {
	public updateInterval = minutes(1);

	private rules: IAutoRoleRule[];

	protected initData: undefined;

	public getDefaultId () {
		return "autorole";
	}

	public async onStart () {
		this.rules = await Promise.all(this.config.rules.map(async ruleConfig => ({
			match: new RoleMatcher(ruleConfig.match),
			apply: await Promise.all(Arrays.or(ruleConfig.apply ?? []).map(role => this.findRole(role))),
			remove: await Promise.all(Arrays.or(ruleConfig.remove ?? []).map(role => this.findRole(role))),
		} as IAutoRoleRule)));
	}

	public async onUpdate () {
		await this.guild.members.fetch();

		for (const rule of this.rules) {
			const users = this.guild.members.cache.filter(member => member.roles.cache.some(role => rule.match.matches(role)));
			for (const [, user] of users) {
				const addRoles = rule.apply.filter(role => !user.roles.cache.has(role.id));
				if (addRoles.length) {
					user.roles.add(addRoles);
					this.logger.info(`Added role(s) ${addRoles.map(role => `'${role.name}'`).join(", ")} to ${user.displayName}.`);
				}

				const removeRoles = rule.remove.filter(role => user.roles.cache.has(role.id));
				if (removeRoles.length) {
					user.roles.remove(removeRoles);
					this.logger.info(`Removed role(s) ${removeRoles.map(role => `'${role.name}'`).join(", ")} from ${user.displayName}.`);
				}
			}
		}
	}
}
