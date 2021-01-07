import { DMChannel, GuildMember, Message, MessageEmbed, User } from "discord.js";
import { Command, CommandMessage, CommandResult, IField } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Paginator } from "../core/Paginatable";
import { Plugin } from "../core/Plugin";
import { tuple } from "../util/Arrays";
import Bound from "../util/Bound";
import { COLOR_BAD, COLOR_GOOD, COLOR_WARNING } from "../util/Colors";
import Strings from "../util/Strings";

export interface IPronounLanguage {
	they: string;
	are: string;
	have: string;
	them: string;
	their: string;
	theirs: string;
}

interface IPronouns {
	subjective: string;
	objective: string;
	possessiveDeterminer: string;
	possessivePronoun: string;
	reflexive: string;
	are?: "is" | "are";
	have?: "has" | "have";
	typeOfPerson?: string;
}

interface ISystemMember {
	name: string;
	avatar?: string;
	pronouns: IPronouns[];
}

interface ISystem {
	members: ISystemMember[];
}

interface PronounsPluginData {
	systems: Record<string, ISystem>;
}

interface PronounsPluginConfig {
	aboveRole?: string;
}

function pronouns (subjective: string, objective: string, possessiveDeterminer: string, possessivePronoun: string, reflexive: string, typeOfPerson?: string, are?: "is" | "are", have?: "has" | "have"): IPronouns {
	return { subjective, objective, possessiveDeterminer, possessivePronoun, reflexive, typeOfPerson, are, have };
}

const PRONOUNS_GENERIC = {
	"she/her": pronouns("she", "her", "her", "hers", "herself"),
	"they/them": pronouns("they", "them", "their", "theirs", "themself", undefined, "are"),
	"he/him": pronouns("he", "him", "his", "his", "himself"),
	"it/its": pronouns("it", "it", "its", "its", "itself"),
};

const pronounRoleRegex = /^[\w ]+\/[\w ]+$/;

enum CommandLanguage {
	PronounsDescription = "Gets your current pronouns, or if you have none, allows you to set them.",
	PronounsQueryDescription = "Gets the pronouns of another member, or members.",
	PronounsQueryArgumentUser = "A user's ID, partial username & tag, or partial display name.",
	PronounsClearDescription = "Clears your pronouns.",
	PronounsToggleDescription = "Toggles a set of generic pronouns.",
	PronounsToggleArgumentPronouns = "Which pronouns to toggle.",
}

export default class PronounsPlugin extends Plugin<PronounsPluginConfig, PronounsPluginData> {
	protected initData = () => ({ systems: {} });

	private get aboveRole () { return this.config.aboveRole && this.guild.roles.cache.get(this.config.aboveRole); }

	public getDefaultId () {
		return "pronouns";
	}

	public getDefaultConfig () {
		return {};
	}

	public referTo (member?: GuildMember | User | Message) {
		if (member instanceof User)
			member = this.guild.members.cache.get(member.id);

		else if (member instanceof Message)
			member = member.member ?? undefined;

		const pronouns = member && this.getSystem(member);
		if (!Array.isArray(pronouns) || !pronouns.length)
			return this.getPronounLanguage(PRONOUNS_GENERIC["they/them"]);

		return this.getPronounLanguage(pronouns[0]);
	}

	private readonly help = new HelpContainerPlugin()
		.addCommand("pronouns", CommandLanguage.PronounsDescription)
		.addCommand("pronouns", CommandLanguage.PronounsToggleDescription, command => command
			.addRawTextArgument("pronounsName", CommandLanguage.PronounsToggleArgumentPronouns, argument => argument
				.addOptions(...Object.keys(PRONOUNS_GENERIC).map(pronounsId => tuple(pronounsId, `Toggle "${pronounsId}" pronouns.`)))))
		.addCommand("pronouns clear", CommandLanguage.PronounsClearDescription)
		.addCommand("pronouns", CommandLanguage.PronounsQueryDescription, command => command
			.addArgument("user", CommandLanguage.PronounsQueryArgumentUser));

	@Command(["help pronouns", "help pronoun", "pronoun help", "pronouns help"])
	protected async commandHelp (message: CommandMessage) {
		this.reply(message, this.help);
		return CommandResult.pass();
	}

	@Command("pronouns clear")
	protected async onCommandPronounsClear (message: CommandMessage) {
		if (!this.data.systems[message.member?.id!])
			return this.reply(message, "you have no pronouns set!")
				.then(() => CommandResult.pass());

		const confirmed = await this.yesOrNo(undefined, this.getPronounsEmbed(message.member!)
			.setColor(COLOR_WARNING)
			.setTitle("Are you sure you want to clear your pronouns?"))
			.reply(message);

		if (!confirmed)
			return this.reply(message, "no changes were made!")
				.then(() => CommandResult.pass());

		delete this.data.systems[message.member!.id];
		this.data.markDirty();

		await this.updatePronouns(message.member!);

		return this.reply(message, new MessageEmbed()
			.setColor(COLOR_BAD)
			.setTitle("Your pronouns have been reset!"))
			.then(() => CommandResult.pass());
	}

	@Command("pronouns")
	protected async onCommandPronouns (message: CommandMessage, query?: string) {
		for (const [genericPronounsId, genericPronouns] of Object.entries(PRONOUNS_GENERIC)) {
			if (query === genericPronounsId) {
				let system = this.data.systems[message.author.id];
				if (system?.members.length > 1)
					break;

				if (!system)
					system = this.data.systems[message.author.id] = {
						members: [
							{
								name: "",
								pronouns: []
							},
						],
					};

				this.data.markDirty();

				for (let i = 0; i < system.members[0].pronouns.length; i++) {
					const pronouns = system.members[0].pronouns[i];
					if ((Object.keys(pronouns) as (keyof IPronouns)[]).every(key => pronouns[key] === genericPronouns[key])) {
						system.members[0].pronouns.splice(i, 1);
						await this.updatePronouns(message.member!);
						return this.reply(message, new MessageEmbed()
							.setColor(COLOR_BAD)
							.setTitle(`You have opted out of generic "${genericPronounsId}" pronouns.`)
							.setDescription(`If you'd like to add custom pronouns, send the \`!pronouns\` command${message.channel instanceof DMChannel ? "" : " to me in a DM"}!`))
							.then(() => CommandResult.pass());
					}
				}

				system.members[0].pronouns.push(genericPronouns);
				await this.updatePronouns(message.member!);
				return this.reply(message, new MessageEmbed()
					.setColor(COLOR_GOOD)
					.setTitle(`You have opted into generic "${genericPronounsId}" pronouns.`))
					.then(() => CommandResult.pass());
			}
		}

		if (query)
			return (await this.findMembers(query))
				.values()
				.map(this.getPronounsEmbed)
				.collect(Paginator.create)
				.setNoContentMessage("No members matched that query! 😭")
				.reply(message)
				.then(() => CommandResult.pass());

		if (!message.member)
			return CommandResult.pass();

		const system = this.getSystem(message.member) ?? { members: [] };
		if ((!(message.channel instanceof DMChannel) || !message.member) && system.members.length && (system.members.length !== 1 || system.members[0].pronouns.length))
			return this.reply(message, this.getPronounsEmbed(message.member!)
				.setFooter("If you want to change your pronouns, use this command in a DM with me!"))
				.then(() => CommandResult.pass());

		let savedMessage = "Saved pronouns!";
		let shouldDoFullConfiguration = true;
		if (!system.members.length || (system.members.length === 1 && !system.members[0].pronouns.length)) {
			await this.addNewOrEditSystemMember(message, system, system.members[0]);
			if (!(message.channel instanceof DMChannel)) {
				shouldDoFullConfiguration = false;
				const pronouns = system.members[0].pronouns[0];
				savedMessage = `You have opted into ${pronouns.subjective}/${pronouns.objective} pronouns!`;
			}
		}

		while (shouldDoFullConfiguration) {
			const response = await Paginator.create(system.members, (systemMember, p, i) => new MessageEmbed()
				.setAuthor(`${system.members.length > 1 ? "System of " : ""}${message.member?.displayName}`, message.author.avatarURL() ?? undefined)
				.setTitle(system.members.length <= 1 ? undefined : `#${i + 1}. ${systemMember.name}`)
				.setThumbnail(systemMember?.avatar)
				.addFields(...this.getPronounFields(systemMember.pronouns, systemMember.name || message.member!.displayName))
				.addField(Strings.BLANK, [`✏ Edit`, system.members.length > 1 ? "🗑 Remove this member" : undefined].filterNullish().join(Strings.SPACER_DOT)
					.newline(["✅ Save", "*️⃣ Add new system member"].join(Strings.SPACER_DOT))))
				.addOption("✅")
				.addOption("*️⃣")
				.addOption("✏")
				.addOption(system.members.length > 1 && "🗑")
				.setShouldDeleteOnUseOption(reaction => !["✅", "*️⃣", "✏", "🗑"].includes(reaction.name))
				.replyAndAwaitReaction(message, reaction => ["✅", "*️⃣", "✏", "🗑"].includes(reaction.name));

			if (response.cancelled)
				return this.reply(message, "no changes were made!")
					.then(() => CommandResult.pass());

			if (response.reaction?.name === "✅")
				break;

			if (response.reaction?.name === "🗑") {
				const confirmed = await this.yesOrNo(undefined, new MessageEmbed()
					.setColor(COLOR_WARNING)
					.setTitle(`Are you sure you want to remove ${response.page?.originalValue.name}?`)
					.setDescription("There is no undo!"))
					.reply(message);

				if (!confirmed)
					continue;

				const index = system.members.indexOf(response.page?.originalValue!);
				if (!system.members[index])
					return CommandResult.pass();

				system.members.splice(index, 1);
			}

			if (response.reaction?.name === "*️⃣")
				await this.addNewOrEditSystemMember(message, system);

			if (response.reaction?.name === "✏")
				await this.addNewOrEditSystemMember(message, system, response.page?.originalValue!)
		}

		this.data.systems[message.member.id] = system;
		this.data.markDirty();

		await this.updatePronouns(message.member);

		await this.reply(message, new MessageEmbed()
			.setColor("00FF00")
			.setTitle(savedMessage));

		return CommandResult.pass();
	}

	private async updatePronouns (member: GuildMember) {
		for (const [, role] of member.roles.cache.filter(role => pronounRoleRegex.test(role.name))) {
			this.logger.info(`Removed pronoun role ${role.name} from ${member.displayName}`);
			await member.roles.remove(role);
		}

		const system = this.getSystem(member)!;
		for (const systemMember of system?.members || [])
			for (const pronouns of systemMember.pronouns) {
				const roleName = `${pronouns.subjective}/${pronouns.objective}`;
				let role = this.guild.roles.cache.find(role => role.name === roleName);
				if (!role) {
					this.logger.info(`Created pronoun role ${roleName}`);
					role = await this.guild.roles.create({
						data: {
							name: roleName,
							position: this.aboveRole && this.aboveRole.position + 1 || undefined,
							permissions: [],
						},
					});
				}

				this.logger.info(`Added pronoun role ${roleName} to ${member.displayName}`);
				await member.roles.add(role);
			}

		await this.prunePronouns();
	}

	private async prunePronouns () {
		const result: string[] = [];

		await this.guild.roles.fetch(undefined, true, true);
		for (const [, role] of this.guild.roles.cache)
			if (pronounRoleRegex.test(role.name))
				if (!role.permissions.toArray().length && !role.members.size) {
					this.logger.info(`Removed unused pronoun role ${role.name}`);
					result.push(role.name);
					await role.delete("Unused");
				}

		return result;
	}

	@Command("pronouns prune")
	protected async onCommandPronounsPrune (message: CommandMessage) {
		if (!message.member?.permissions.has("ADMINISTRATOR") && message.author.id !== "92461141682307072") // chiri is all-powerful
			return CommandResult.pass();

		const removed = await this.prunePronouns();
		await this.reply(message, `removed **${removed.length}** unused pronoun roles`
			.join(removed.length ? `: ${removed.join(", ")}` : "."));

		return CommandResult.pass();
	}

	private async addNewOrEditSystemMember (message: CommandMessage, system: ISystem, systemMember?: ISystemMember) {
		const isNewMember = !systemMember;
		systemMember ??= { name: "", pronouns: [] };
		if (system.members.length > 1 || isNewMember) {
			if (system.members.length) {
				// prompt system member name
				let result = await this.prompter("What would you like to name this system member?")
					.setDefaultValue(systemMember.name || undefined)
					.reply(message);

				if (result.cancelled)
					return await this.reply(message, "Cancelled adding/editing system member.")
						.then(() => { });

				result.apply(systemMember, "name");

				// prompt system member avatar
				result = await this.prompter("Send the URL for this system member's avatar.")
					.setThumbnail(systemMember.avatar)
					.setDefaultValue(systemMember.avatar)
					.setDeletable()
					.setValidator(message => Strings.isURL(message.content) ? true : "Not a valid URL.")
					.reply(message);

				if (result.cancelled)
					return await this.reply(message, "Cancelled adding/editing system member.")
						.then(() => { });

				result.apply(systemMember, "avatar");
			}
		}

		if (isNewMember)
			await this.addNewOrEditPronouns(message, system, systemMember); // add initial pronouns for member

		if (system.members.length === 1 && !isNewMember && systemMember.pronouns.length <= 1)
			return this.addNewOrEditPronouns(message, system, systemMember, systemMember.pronouns[0]);

		// prompt system member pronouns (link to pronoun dressing room)
		while (true) {
			const response = await Paginator.create(systemMember.pronouns, pronouns => new MessageEmbed()
				.setAuthor((system.members.length > 1 || isNewMember && systemMember?.name) && `Pronouns of ${systemMember?.name ?? "Unknown member"}` || undefined)
				.setTitle(`${pronouns.subjective}/${pronouns.objective}`)
				.setThumbnail(systemMember?.avatar)
				.addFields(...this.getPronounFields([pronouns], systemMember?.name || message.member?.displayName))
				.addField(Strings.BLANK, [`✏ Edit`, "🗑 Remove"].join(Strings.SPACER_DOT)
					.newline(["✅ Confirm all pronouns", "*️⃣ Add alternate pronouns"].join(Strings.SPACER_DOT))))
				.addOption("✅")
				.addOption("*️⃣")
				.addOption("✏")
				.addOption("🗑")
				.setShouldDeleteOnUseOption(reaction => !["✅", "*️⃣", "✏", "🗑"].includes(reaction.name))
				.replyAndAwaitReaction(message, reaction => ["✅", "*️⃣", "✏", "🗑"].includes(reaction.name));

			if (response.cancelled)
				return this.reply(message, "no changes were made!")
					.then(() => CommandResult.pass());

			if (response.reaction?.name === "✅")
				break;

			if (response.reaction?.name === "🗑") {
				const confirmed = await this.yesOrNo(undefined, new MessageEmbed()
					.setColor(COLOR_WARNING)
					.setTitle(`Are you sure you want to remove this set of pronouns?`)
					.setDescription("There is no undo! You will have to manually reconfigure them."))
					.reply(message);

				if (!confirmed)
					continue;

				const index = systemMember.pronouns.indexOf(response.page?.originalValue!);
				if (!systemMember.pronouns[index])
					return CommandResult.pass();

				systemMember.pronouns.splice(index, 1);
			}

			if (response.reaction?.name === "*️⃣")
				await this.addNewOrEditPronouns(message, system, systemMember);

			if (response.reaction?.name === "✏")
				await this.addNewOrEditPronouns(message, system, systemMember, response.page?.originalValue!)
		}

		if (!system.members.includes(systemMember))
			system.members.push(systemMember);
	}

	private async addNewOrEditPronouns (message: CommandMessage, system: ISystem, systemMember: ISystemMember, pronouns?: IPronouns) {
		const existingPronounsIndex = systemMember.pronouns.indexOf(pronouns!);

		const genericPronouns = await this.promptReaction(await this.reply(message, new MessageEmbed()
			.setTitle("Would you like to use generic pronouns or custom pronouns?")
			.addField(Strings.BLANK, ["♀️ she/her", "♂️ he/him", "⚧ they/them", "✏ Custom", "❌ Cancel"].join(Strings.SPACER_DOT))))
			.addOption("♀️")
			.addOption("♂️")
			.addOption("⚧")
			.addOption("✏")
			.addOption("❌")
			.reply(message);

		if (!genericPronouns.response || genericPronouns.response?.name === "❌")
			return await this.reply(message, "Cancelled adding/editing pronouns.")
				.then(() => { });

		if (genericPronouns.response?.name === "♀️")
			pronouns = PRONOUNS_GENERIC["she/her"];

		else if (genericPronouns.response?.name === "♂️")
			pronouns = PRONOUNS_GENERIC["he/him"];

		else if (genericPronouns.response?.name === "⚧")
			pronouns = PRONOUNS_GENERIC["they/them"];

		else {
			const result = await this.prompter(`Configure pronouns using the "Pronoun Dressing Room"`)
				.setURL("http://www.pronouns.failedslacker.com")
				.setDefaultValue(pronouns ? this.getExampleLink(pronouns, systemMember.name || message.member?.displayName) : undefined)
				.setValidator(message => {
					const result = this.parsePronounDressingRoomURL(message.content);
					return typeof result === "string" ? result : true;
				})
				.reply(message);

			if (result.cancelled)
				return await this.reply(message, "Cancelled adding/editing pronouns.")
					.then(() => { });

			if (!result.reaction)
				pronouns = this.parsePronounDressingRoomURL(result.value!) as IPronouns;
		}

		if (existingPronounsIndex >= 0)
			systemMember.pronouns.splice(existingPronounsIndex, 1);

		if (!systemMember.pronouns.includes(pronouns!))
			systemMember.pronouns.push(pronouns!);
	}

	private parsePronounDressingRoomURL (url: string): IPronouns | string {
		const urlObject = Strings.isURL(url, "www.pronouns.failedslacker.com");
		if (!urlObject)
			return `Not a valid "Pronoun Dressing Room" URL.`;

		const requiredURLParams: [string, string][] = [
			["subjective", "subjective pronoun"],
			["object", "objective pronoun"],
			["possDet", "possessive determiner"],
			["possPro", "possessive pronoun"],
			["reflexive", "reflexive pronoun"],
		];

		const missingParams = requiredURLParams.filter(([urlParam]) => !urlObject.searchParams.get(urlParam))
			.map(([, pronounName]) => pronounName)
			.join(", ");

		if (missingParams.length)
			return `Missing ${missingParams}.`;

		return {
			subjective: urlObject.searchParams.get("subjective")!,
			objective: urlObject.searchParams.get("object")!,
			possessiveDeterminer: urlObject.searchParams.get("possDet")!,
			possessivePronoun: urlObject.searchParams.get("possPro")!,
			reflexive: urlObject.searchParams.get("reflexive")!,
			typeOfPerson: urlObject.searchParams.get("person") ?? undefined,
		};
	}

	@Bound
	private getPronounsEmbed (member: GuildMember) {
		const pronouns = this.getSystem(member);
		return new MessageEmbed()
			.setTitle(`Pronouns of ${member.displayName}`)
			.setThumbnail(member.user.avatarURL() ?? undefined)
			.setDescription(pronouns ? undefined : "This user has no pronouns set!")
			.addFields(...!pronouns ? [] : this.getSystemPronounFields(pronouns, member.displayName));
	}

	private getSystemPronounFields (system: ISystem, name?: string): IField[] {
		if (system.members.length > 1)
			return system.members.map(systemMember => ({
				name: systemMember.name,
				value: Strings.INDENT.join(this.getPronounFields(systemMember.pronouns, systemMember.name)
					.filter(({ name }) => systemMember.pronouns.length < 4 ? true : !name.includes("Examples"))
					.map(pronoun => `${pronoun.name}: **${pronoun.value}**`)
					.join(`\n${Strings.INDENT}`)),
			}));

		return this.getPronounFields(system.members[0].pronouns)
	}

	private getPronounFields (pronouns: IPronouns[], name?: string): IField[] {
		if (!pronouns.length)
			return [];

		return [
			{ name: "Subjective", value: pronouns.map(pronoun => pronoun.subjective).join(", ") },
			{ name: "Objective", value: pronouns.map(pronoun => pronoun.objective).join(", ") },
			{ name: "Possessive determiner", value: pronouns.map(pronoun => pronoun.possessiveDeterminer).join(", ") },
			{ name: "Possessive pronoun", value: pronouns.map(pronoun => pronoun.possessivePronoun).join(", ") },
			{ name: "Reflexive", value: pronouns.map(pronoun => pronoun.reflexive).join(", ") },
			{ name: "Type of person", value: pronouns.map(pronoun => pronoun.typeOfPerson || "person").join(", ") },
			{
				name: `Examples of these pronouns`,
				value: pronouns
					.map(pronounSet => this.getExampleLink(pronounSet, name))
					.join(", "),
			},
		];
	}

	private getSystem (member: GuildMember) {
		if (this.data.systems[member.id])
			return this.data.systems[member.id];

		const pronouns = Object.entries(PRONOUNS_GENERIC)
			.filter(([genericPronounsId]) => member.roles.cache.some(role => role.name === genericPronounsId))
			.map(([, genericPronouns]) => genericPronouns);

		return pronouns.length ? { members: [{ name: "", pronouns }] } : undefined;
	}

	private getExampleLink (pronouns: IPronouns, name?: string) {
		const link = `http://www.pronouns.failedslacker.com/?${[
			`subjective=${encodeURIComponent(pronouns.subjective)}`,
			`object=${encodeURIComponent(pronouns.objective)}`,
			`possDet=${encodeURIComponent(pronouns.possessiveDeterminer)}`,
			`possPro=${encodeURIComponent(pronouns.possessivePronoun)}`,
			`reflexive=${encodeURIComponent(pronouns.reflexive)}`,
			`name=${encodeURIComponent(name ?? "")}`,
			`person=${encodeURIComponent(pronouns.typeOfPerson ?? "")}`,
		].filterNullish().join("&")}`

		return `[${pronouns.subjective}/${pronouns.objective}](${link})`;
	}

	private getPronounLanguage (pronouns: IPronouns): IPronounLanguage {
		return {
			they: pronouns.subjective,
			them: pronouns.objective,
			their: pronouns.possessiveDeterminer,
			theirs: pronouns.possessivePronoun,
			are: pronouns.are ?? "is",
			have: pronouns.have ?? "have",
		};
	}
}