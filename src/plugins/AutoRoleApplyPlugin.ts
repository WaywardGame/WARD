import { Role } from "discord.js";
import { Plugin } from "../core/Plugin";
import Arrays from "../util/Arrays";
import Regex from "../util/Regex";
import { minutes } from "../util/Time";

export interface IAutoRoleConfig {
	rules: IAutoRoleRuleConfig[];
}

interface IAutoRoleRuleConfig {
	match: ArrayOr<string>;
	apply: ArrayOr<string>;
}

class RoleMatcher {

	private matchers: (string | RegExp)[];

	public constructor (config: ArrayOr<string>) {
		this.matchers = Arrays.or(config)
			.map(matcher => Regex.parse(matcher) ?? matcher);
	}

	public matches (role: Role) {
		return this.matchers.some(matcher => {
			if (typeof matcher === "string")
				return role.id === matcher || role.name === matcher;

			return matcher.test(role.name);
		});
	}
}

interface IAutoRoleRule {
	match: RoleMatcher;
	apply: Role[];
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
			apply: await Promise.all(Arrays.or(ruleConfig.apply).map(role => this.findRole(role))),
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
			}
		}
	}
}
