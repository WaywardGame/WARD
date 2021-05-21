import chalk from "chalk";
import { DMChannel, Emoji, GuildEmoji, GuildMember, Message, MessageAttachment, MessageEmbed, ReactionEmoji, User } from "discord.js";
import { Command, CommandMessage, CommandResult, IField, ImportPlugin } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Paginator } from "../core/Paginatable";
import { IInherentPluginData, Plugin } from "../core/Plugin";
import Arrays from "../util/Arrays";
import Bound from "../util/Bound";
import Enums from "../util/Enums";
import Strings from "../util/Strings";
import { days, getISODate, getWeekNumber, minutes, months, weeks, years } from "../util/Time";
import PronounsPlugin from "./PronounsPlugin";

interface IStoryConfig {

}

interface IStoryNameSearchCache {
	hash: number;
	terms: string[];
}

const SYMBOL_STORY_NAME_SEARCH_CACHE = Symbol("STORY_NAME_SEARCH_CACHE");

interface IStory {
	[SYMBOL_STORY_NAME_SEARCH_CACHE]?: IStoryNameSearchCache;
	author: string;
	name: string;
	synopsis: string;
	thumbnail?: string;
	scribble?: string;
	ao3?: string;
	patreon?: string;
	otherURL?: string;
	status?: keyof typeof Status;
}

enum Status {
	complete,
	oneshot,
	ongoing,
	upcoming,
	hiatus,
	cancelled,
	unknown,
}

interface IAuthor {
	scribble?: string;
	patreon?: string;
	ao3?: string;
	otherURL?: string;
	bio?: string;
	wordTracker?: Record<string, number>;
}

interface IStoryData extends IInherentPluginData<IStoryConfig> {
	authors: Record<string, IAuthor>;
	stories: Record<string, IStory[]>;
}

enum CommandLanguage {
	AuthorWizardDescription = "_DM-only._ Enters a wizard to register/edit your author profile, which can be looked up by other users with `!author <yourname>`",
	AuthorUnregisterDescription = "_DM-only._ Unregisters/deletes your author profile.",
	StoryWizardDescription = "_DM-only._ Enters a wizard to register/edit a new story. Does not require registering your author profile.",
	StoryUnregisterDescription = "_DM-only._ Unregisters/deletes one of your stories.",
	StoryUnregisterArgumentName = "The name of the story, via a list of search terms. Finds the closest match for the provided terms.",
	StoryQueryDescription = "Searches for stories.",
	StoryQueryArgumentName = "The name of the story, via a list of search terms. Finds all matches for the provided terms, sorted by how near a match they are.",
	AuthorQueryDescription = "Searches for an author.",
	AuthorQueryArgumentAuthor = "A user's ID, partial username & tag, or partial display name. If not provided, shows your own profile.",
	StoriesMineListDescription = "Shows a list of all of your registered stories.",
	StoriesListDescription = "Shows a list of all registered stories (shuffled), or all stories by a specific author (not shuffled).",
	StoriesListArgumentAuthor = "The author to show the stories of. If not provided, shows all registered stories.",
	WordTrackerEditDescription = "Adds or removes tracked words.",
	WordTrackerEditArgumentDate = "The date to add or remove tracked words to or from.",
	WordTrackerEditArgumentCounts = "The number of words to add. You can list multiple numbers, positive or negative.",
	WordTrackerClearDescription = "Removes all words from a day.",
	WordTrackerQueryDescription = "Gets your word count.",
	WordTrackerQueryArgumentTimespanYear = "Gets words tracked in the past year.",
	WordTrackerQueryArgumentTimespanMonth = "Gets words tracked in the past month.",
	WordTrackerQueryArgumentTimespanMonths = "Gets words tracked in the past `{count}` months.",
	WordTrackerQueryArgumentTimespanWeek = "Gets words tracked in the past week.",
	WordTrackerQueryArgumentTimespanWeeks = "Gets words tracked in the past `{count}` weeks.",
	WordTrackerQueryArgumentTimespanDay = "Gets words tracked today.",
	WordTrackerQueryArgumentTimespanDays = "Gets words tracked in the past `{count}` days.",
	WordTrackerGetCSV = "Exports a CSV file of your entire word tracker history.",
}

export default class StoryPlugin extends Plugin<IStoryConfig, IStoryData> {

	@ImportPlugin("pronouns")
	private pronouns: PronounsPlugin = undefined!;

	public getDefaultConfig () {
		return {};
	}

	protected initData: () => IStoryData = () => ({ authors: {}, stories: {} });

	public getDefaultId () {
		return "stories";
	}

	public getDescription () {
		return "A plugin for sharing your stories!";
	}

	private statusEmoji: Record<keyof typeof Status, GuildEmoji>;

	public onStart () {
		this.statusEmoji = Object.fromEntries(Enums.keys(Status)
			.map(status => [status, this.guild.emojis.cache.find(emoji => emoji.name === status)!])) as Record<keyof typeof Status, GuildEmoji>;
	}

	private readonly helpStories = () => new HelpContainerPlugin()
		.addCommand("author register|edit", CommandLanguage.AuthorWizardDescription)
		.addCommand("author unregister|delete", CommandLanguage.AuthorUnregisterDescription)
		.addCommand("story register|edit", CommandLanguage.StoryWizardDescription)
		.addCommand("story unregister|delete", CommandLanguage.StoryUnregisterDescription, command => command
			.addRemainingArguments("name", CommandLanguage.StoryUnregisterArgumentName))
		.addCommand("story", CommandLanguage.StoryQueryDescription, command => command
			.addRemainingArguments("name", CommandLanguage.StoryQueryArgumentName))
		.addCommand("author", CommandLanguage.AuthorQueryDescription, command => command
			.addArgument("author", CommandLanguage.AuthorQueryArgumentAuthor, argument => argument
				.setOptional()))
		.addCommand("stories mine", CommandLanguage.StoriesMineListDescription)
		.addCommand("stories", CommandLanguage.StoriesListDescription, command => command
			.addArgument("author", CommandLanguage.StoriesListArgumentAuthor, argument => argument
				.setOptional()))
		.addCommand("help words", "Get help with the `!words` command");

	@Command(["help stories", "stories help", "help author", "author help", "help story", "story help"])
	protected async commandHelp (message: CommandMessage) {
		this.reply(message, this.helpStories());
		return CommandResult.pass();
	}

	private readonly helpWords = () => new HelpContainerPlugin()
		.addCommand("words", CommandLanguage.WordTrackerEditDescription, command => command
			.addArgument("date", CommandLanguage.WordTrackerEditArgumentDate, argument => argument
				.setDefaultValue("today"))
			.addRemainingArguments("counts", CommandLanguage.WordTrackerEditArgumentCounts))
		.addCommand("words", CommandLanguage.WordTrackerClearDescription, command => command
			.addArgument("date", CommandLanguage.WordTrackerEditArgumentDate, argument => argument
				.setDefaultValue("today"))
			.addRawTextArgument("clear|remove|delete"))
		.addCommand("words", CommandLanguage.WordTrackerQueryDescription, command => command
			.addRawTextArgument("timespan", undefined, argument => argument
				.addOption("year", CommandLanguage.WordTrackerQueryArgumentTimespanYear)
				.addOption("month", CommandLanguage.WordTrackerQueryArgumentTimespanMonth)
				.addOption("months {count}", CommandLanguage.WordTrackerQueryArgumentTimespanMonths)
				.addOption("week", CommandLanguage.WordTrackerQueryArgumentTimespanWeek)
				.addOption("weeks {count}", CommandLanguage.WordTrackerQueryArgumentTimespanWeeks)
				.addOption("day", CommandLanguage.WordTrackerQueryArgumentTimespanDay)
				.addOption("days {count}", CommandLanguage.WordTrackerQueryArgumentTimespanDays)
				.setOptional()))
		.addCommand("words csv", CommandLanguage.WordTrackerGetCSV);

	@Command(["help words", "words help"])
	protected async commandHelpWords (message: CommandMessage) {
		this.reply(message, this.helpWords());
		return CommandResult.pass();
	}

	private getWordsWritten (author: User, timespan?: number): { error: string, count?: number, days?: Map<Date, number> } | { error?: undefined, count: number, days: Map<Date, number> } {
		if (timespan && timespan > years(1))
			return { error: "timespan too long" };

		const wordTracker = this.data.authors[author.id]?.wordTracker;
		if (!wordTracker)
			return { count: 0, days: new Map() };

		const now = Date.now();
		const theFuture = now + days(1);

		const daysResult = new Map<Date, number>();
		let result = 0;
		if (!timespan)
			for (const date in wordTracker)
				result += wordTracker[date];
		else
			for (let time = now - timespan; time < theFuture; time += days(1)) {
				const date = new Date(time);
				const dayCount = wordTracker[getISODate(date)] || 0;
				if (dayCount)
					daysResult.set(date, dayCount);
				result += dayCount;
			}

		return { count: result, days: !timespan ? this.getWordsWritten(author, weeks(1)).days || daysResult : daysResult };
	}

	@Command(["words today", "words day", "words days"])
	protected async onCommandWordsToday (message: CommandMessage, countStr: string) {
		const count = +countStr || 1;
		return this.replyWordsHistory(message, days(count), `${count} day(s)`);
	}

	@Command(["words week", "words weeks"])
	protected async onCommandWordsWeek (message: CommandMessage, countStr: string) {
		const count = +countStr || 1;
		return this.replyWordsHistory(message, weeks(count), `${count} week(s)`);
	}

	@Command(["words month", "words months"])
	protected async onCommandWordsMonth (message: CommandMessage, countStr: string) {
		const count = +countStr || 1;
		return this.replyWordsHistory(message, months(count), `${count} month(s)`);
	}

	@Command("words year")
	protected async onCommandWordsYear (message: CommandMessage) {
		return this.replyWordsHistory(message, years(1), "year");
	}

	@Command("words csv")
	protected async onWordsCsv (message: CommandMessage) {
		const wordTracker = this.data.authors[message.author.id]?.wordTracker;
		if (!wordTracker)
			return this.reply(message, "no history found. 😭")
				.then(reply => CommandResult.fail(message, reply));

		const csv = Object.entries(wordTracker)
			.map(columns => columns.join(","))
			.sort()
			.join("\n");

		message.reply(new MessageAttachment(Buffer.from(`Date,Words\n${csv}`, "utf8"), `words_${message.author.username.replace(/\W/g, "")}.csv`));
		return CommandResult.pass();
	}

	protected async replyWordsHistory (message: CommandMessage, ms?: number, timescaleMessage?: string) {
		const written = this.getWordsWritten(message.author, ms);
		if (written.error)
			return this.reply(message, written.error)
				.then(reply => CommandResult.fail(message, reply));

		const writingDays = written.days!.entries()
			.toArray(([date, count]) => ({
				name: date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
				value: Intl.NumberFormat().format(count),
				inline: true,
				date,
				count,
			}) as IField & { date?: Date; count?: number });

		const thisWeek = getWeekNumber();
		let weekCount = 0;
		let touchWeek = thisWeek;
		for (let d = writingDays.length - 1; d >= -1; d--) {
			const week = d === -1 ? -1 : getWeekNumber(writingDays[d].date);
			if (week !== touchWeek || d === -1) {
				if (weekCount) {
					const weekName = touchWeek === thisWeek ? "this week" : touchWeek === thisWeek - 1 ? "last week" : `${thisWeek - touchWeek} weeks ago`;
					writingDays.splice(d + 1, 0, {
						name: `\u200b`,
						value: `__**${Intl.NumberFormat().format(weekCount!)} words ${weekName}**__`,
						inline: false,
					});
				}

				weekCount = 0;
				touchWeek = week;
			}

			weekCount! += d === -1 ? 0 : writingDays[d].count!;
		}

		Paginator.create(writingDays)
			.setPageHeader(`${written.count} words${timescaleMessage ? ` in the past ${timescaleMessage}` : ""}`)
			.setPageDescription(timescaleMessage ? undefined : "History in the past week:")
			.setNoContentMessage("...no history found. 😭")
			.setStartOnLastPage()
			.reply(message);

		return CommandResult.pass();
	}

	@Command("words")
	protected async onCommandWords (message: CommandMessage, countOrWhen?: string, ...counts: string[]) {
		if (!isNaN(Math.floor(+countOrWhen!)) || countOrWhen === "clear" || countOrWhen === "remove" || countOrWhen === "delete")
			counts.unshift(countOrWhen!), countOrWhen = undefined;

		const clear = counts.length === 1 && (counts[0] === "clear" || counts[0] === "remove" || counts[0] === "delete");
		if (counts.length === 0)
			return this.replyWordsHistory(message);

		let wordCount = 0;
		for (let count of counts)
			wordCount += Math.floor(+count);

		if (!clear && isNaN(wordCount))
			return this.reply(message, "those word counts are invalid.")
				.then(reply => CommandResult.fail(message, reply));

		const author: Partial<IAuthor> = { ...this.data.authors[message.author.id] };
		if (!author.wordTracker)
			author.wordTracker = {};

		const date = countOrWhen === undefined ? new Date()
			: countOrWhen === "yesterday" ? new Date(Date.now() - days(1))
				: new Date(`${countOrWhen} utc`);

		if (date.getFullYear() === 2001)
			date.setFullYear(new Date().getFullYear());

		const today = getISODate(date);
		if (clear)
			delete author.wordTracker[today];
		else
			author.wordTracker[today] = wordCount + (author.wordTracker[today] || 0);

		await this.saveAuthor(message.author, author);

		const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
		return this.reply(message, `${isNaN(wordCount) || wordCount < 0 ? "removed" : "added"} **${clear ? "all" : Math.abs(wordCount)}** words ${isNaN(wordCount) || wordCount < 0 ? "from" : "to"} **${dateStr}**.  (${dateStr}: ${author.wordTracker[today] || 0}  ·  Overall: ${this.getWordsWritten(message.author).count || 0})`)
			.then(() => CommandResult.pass());
	}

	@Command(["author register", "author edit"])
	protected async onCommandAuthorWizard (message: CommandMessage) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "Please use this command in a DM with me so as to not spam the chat. Thanks!");
			return CommandResult.pass();
		}

		this.logger.verbose(this.getName(message.author), `entered the author wizard`);
		await this.clearReactions(message);
		await this.authorWizard(message);
		this.logger.verbose(this.getName(message.author), `exited the author wizard`);

		return CommandResult.pass();
	}

	@Command(["author unregister", "author delete"])
	protected async onCommandAuthorUnregister (message: CommandMessage) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "Please use this command in a DM with me so as to not spam the chat. Thanks!");
			return CommandResult.pass();
		}

		const sure = await this.yesOrNo("Are you sure you want to delete your author profile?")
			.reply(message);

		if (!sure) {
			await this.reply(message, "okay, I've cancelled this operation.");
			return CommandResult.pass();
		}

		delete this.data.authors[message.author.id];
		this.logger.info(this.getName(message.author), `removed ${this.pronouns.referTo(message.author).their} profile`);
		await this.reply(message, "Your author profile has been unregistered. 😭");
		return CommandResult.pass();
	}

	@Command("story register")
	protected async onCommandStoryRegister (message: CommandMessage, ...queryArgs: string[]) {
		return this.commandStoryRegisterEditInternal(message, "register", queryArgs);
	}

	@Command("story edit")
	protected async onCommandStoryEdit (message: CommandMessage, ...queryArgs: string[]) {
		return this.commandStoryRegisterEditInternal(message, "edit", queryArgs);
	}

	private async commandStoryRegisterEditInternal (message: CommandMessage, type: "register" | "edit", queryArgs: string[]) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "Please use this command in a DM with me so as to not spam the chat. Thanks!");
			return CommandResult.pass();
		}

		const storyId = queryArgs.length === 0 && type === "register" ? undefined
			: await this.handleStoryQuery(message, queryArgs);

		if (typeof storyId !== "number" && storyId !== undefined)
			return storyId;

		this.logger.verbose(this.getName(message.author), `entered the story wizard`);
		await this.storyWizard(message, storyId);
		this.logger.verbose(this.getName(message.author), `exited the story wizard`);

		return CommandResult.pass();
	}

	@Command(["story unregister", "story delete"])
	protected async onCommandStoryUnregister (message: CommandMessage, ...queryArgs: string[]) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "Please use this command in a DM with me so as to not spam the chat. Thanks!");
			return CommandResult.pass();
		}

		const stories = this.getStoriesBy(message.author);
		if (!stories.length) {
			await this.reply(message, "you have no stories registered. 🤔")
			return CommandResult.pass();
		}

		let storyId = await this.handleStoryQuery(message, queryArgs);
		if (typeof storyId !== "number")
			return storyId;

		const story = stories[storyId];

		const sure = await this.yesOrNo("are you sure you want to delete this story?", this.generateStoryEmbed(story))
			.reply(message);

		if (!sure) {
			await this.reply(message, "okay, I've cancelled this operation.");
			return CommandResult.pass();
		}

		storyId = stories.indexOf(story);
		stories.splice(storyId, 1);
		this.data.markDirty();

		await this.reply(message, `you got it, I've unregistered your story _${story.name}_.`);
		return CommandResult.pass();
	}

	@Command("story")
	protected async onCommandStoryQuery (message: CommandMessage, ...queryArgs: string[]) {
		Paginator.create(this.queryStories(queryArgs).map(({ data }) => data), this.generateStoryEmbed)
			.reply(message);

		return CommandResult.pass();
	}

	@Command("author")
	protected async onCommandAuthor (message: CommandMessage, queryMember?: string | GuildMember) {
		let members: Iterable<GuildMember> = [queryMember instanceof GuildMember ? queryMember : message.member!];

		if (queryMember && !(queryMember instanceof GuildMember)) {
			const queryResult = await this.findMember(queryMember);
			if (!queryResult)
				members = []

			else if (queryResult instanceof GuildMember)
				members = [queryResult];

			else
				members = queryResult.values();
		}

		await this.clearReactions(message);
		Paginator.create(members, this.generateAuthorEmbed)
			.addOption("📖", "View this author's stories")
			.addOption(message.channel instanceof DMChannel && (page => page.originalValue.id === message.author.id && "✏"), "Edit your profile")
			.event.subscribe("reaction", async (paginator: Paginator<GuildMember>, reaction: Emoji | ReactionEmoji, responseMessage: Message) => {
				const member = paginator.get().originalValue;
				if (reaction.name === "📖") {
					paginator.cancel();
					this.onCommandStories(message, member);
				}

				else if (reaction.name === "✏" && member.id === message.author.id && message.channel instanceof DMChannel) {
					paginator.cancel();
					this.onCommandAuthorWizard(message);
				}
			})
			.reply(message);

		return CommandResult.pass();
	}

	@Command("stories mine")
	protected async onCommandStoriesMine (message: CommandMessage) {
		return this.onCommandStories(message, this.guild.members.cache.get(message.author.id));
	}

	@Command("stories")
	protected async onCommandStories (message: CommandMessage, queryMember?: string | GuildMember) {
		let member: GuildMember | undefined;

		if (queryMember) {
			if (queryMember instanceof GuildMember)
				member = queryMember
			else {
				const result = this.validateFindResult(await this.findMember(queryMember));
				if (result.error !== undefined)
					return this.reply(message, result.error)
						.then(reply => CommandResult.fail(message, reply));

				member = result.member;
			}
		}

		await this.clearReactions(message);

		const stories = member ? this.getStoriesBy(member) : Arrays.shuffle(Object.values(this.data.stories).flat());
		Paginator.create(stories, story => this.generateStoryEmbed(story))
			.addOption(message.channel instanceof DMChannel && (page => page.originalValue.author === message.author.id && "✏"), "Edit story")
			.addOption("👤", "View author's profile")
			.event.subscribe("reaction", async (paginator: Paginator<IStory>, reaction: Emoji | ReactionEmoji, responseMessage: Message) => {
				if (reaction.name !== "✏" && reaction.name !== "👤")
					return;

				paginator.cancel();

				if (reaction.name === "👤") {
					message.previous = CommandResult.mid(message, responseMessage);
					this.onCommandAuthor(message, member);

				} else if (paginator.get().originalValue.author === message.author.id && message.channel instanceof DMChannel) {
					this.logger.verbose(this.getName(message.author), `entered the story wizard`);
					await this.storyWizard(message, stories.indexOf(paginator.get().originalValue));
					this.logger.verbose(this.getName(message.author), `exited the story wizard`);
				}
			})
			.reply(message);

		return CommandResult.pass();
	}

	private getWizardIdentity (story?: Partial<IStory>) {
		return [story?.name === undefined ? "New story" : `Editing ${story.name}`, story?.thumbnail] as const;
	}

	private async storyWizard (message: CommandMessage, storyId?: number) {
		const story: Partial<IStory> = storyId !== undefined ? this.data.stories[message.author.id]?.[storyId] : { author: message.author.id };

		if (!story)
			return this.logger.error("Failed to retrieve story for story wizard. Who did this!!!");

		////////////////////////////////////
		// Author
		//

		if (!this.data.authors[message.author.id]) {
			if (await this.yesOrNo("Oh! Seems like you haven't set up your author profile yet. **Would you like to do that first?**").reply(message))
				await this.authorWizard(message);
		}

		////////////////////////////////////
		// Name
		//

		let response = await this.prompter(`What's the name of your story?`)
			.setIdentity(...this.getWizardIdentity(story))
			.setDefaultValue(story.name)
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		response.apply(story, "name");

		////////////////////////////////////
		// Thumbnail
		//

		response = await this.prompter("What's the story's thumbnail?")
			.setDescription(`Must be a URL.\nHint: If you want to use your Scribble Hub thumbnail, right click on it and hit "copy link address."`)
			.setIdentity(...this.getWizardIdentity(story))
			.setDefaultValue(story.thumbnail)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content) ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		response.apply(story, "thumbnail");

		////////////////////////////////////
		// Synopsis
		//

		response = await this.prompter(`What's the story's synopsis?`)
			.setIdentity(...this.getWizardIdentity(story))
			.setDefaultValue(story.synopsis)
			.setDeletable()
			.setTimeout(minutes(20))
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		response.apply(story, "synopsis");

		////////////////////////////////////
		// Scribble
		//

		response = await this.prompter(`What's the Scribble Hub URL for your story?`)
			.setIdentity(...this.getWizardIdentity(story))
			.setDefaultValue(story.scribble)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.scribblehub.com") ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		response.apply(story, "scribble");

		////////////////////////////////////
		// Patreon
		//

		response = await this.prompter("What's the Patreon URL for your story?")
			.setDescription(`Hint: If you tag all chapters of a story with the same tag, you can click on that tag to get the link for it.`)
			.setIdentity(...this.getWizardIdentity(story))
			.setDefaultValue(story.patreon)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.patreon.com") ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		response.apply(story, "patreon");

		////////////////////////////////////
		// Ao3
		//

		response = await this.prompter(`What's the Ao3 URL for your story?`)
			.setIdentity(...this.getWizardIdentity(story))
			.setDefaultValue(story.ao3)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "archiveofourown.org") ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		response.apply(story, "ao3");

		////////////////////////////////////
		// Other URL
		//

		response = await this.prompter("What's one more URL for your story?")
			.setDescription("IE, not Scribble Hub, not Patreon, not Ao3.")
			.setIdentity(...this.getWizardIdentity(story))
			.setDefaultValue(story.otherURL)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content) ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.otherURL = response.content;

		////////////////////////////////////
		// Status
		//

		const statusResult = await this.promptReaction("What's the story's status?")
			.setIdentity(...this.getWizardIdentity(story))
			.addOptions(...Enums.keys(Status).map(status => [this.statusEmoji[status], Strings.sentence(status)] as const))
			.addCancelOption()
			.reply(message);

		if (!statusResult.response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		story.status = this.statusFromEmoji(statusResult.response);

		////////////////////////////////////
		// Save
		//

		await this.registerStory(message.author, story as IStory);
		return this.reply(message, "Story registration created/updated. Thanks!");
	}

	private async authorWizard (message: CommandMessage) {
		const author: Partial<IAuthor> = { ...this.data.authors[message.author.id] };

		////////////////////////////////////
		// Bio
		//

		const wizard = ["Author wizard", message.author.avatarURL() ?? undefined] as const;

		let response = await this.prompter("What text would you like in your bio?")
			.setIdentity(...wizard)
			.setDefaultValue(author.bio)
			.setDeletable()
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		response.apply(author, "bio");

		////////////////////////////////////
		// Scribble
		//

		response = await this.prompter("What's your Scribble Hub URL?")
			.setIdentity(...wizard)
			.setDefaultValue(author.scribble)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.scribblehub.com") ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		response.apply(author, "scribble");

		////////////////////////////////////
		// Patreon
		//

		response = await this.prompter("What's your Patreon URL?")
			.setIdentity(...wizard)
			.setDefaultValue(author.patreon)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.patreon.com") ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		response.apply(author, "patreon");

		////////////////////////////////////
		// Ao3
		//

		response = await this.prompter("What's your Ao3 URL?")
			.setIdentity(...wizard)
			.setDefaultValue(author.ao3)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "archiveofourown.org") ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		response.apply(author, "ao3");

		////////////////////////////////////
		// Other
		//

		response = await this.prompter("What's a URL for a profile you have on another website?")
			.setIdentity(...wizard)
			.setDescription("IE, not Scribble Hub, not Patreon, not Ao3.")
			.setDefaultValue(author.otherURL)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content) ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		response.apply(author, "otherURL");

		////////////////////////////////////
		// Save
		//

		await this.saveAuthor(message.author, author);

		return this.reply(message, "Author registration created/updated. Thanks!");
	}

	private async saveAuthor (user: User | GuildMember, author: IAuthor) {
		this.data.authors[user.id] = author;
		await this.save();
		this.logger.info(this.getName(user), `updated ${this.pronouns.referTo(user).their} profile`);
	}

	private async registerStory (user: User | GuildMember, story: IStory) {
		let stories = this.data.stories[user.id];
		if (!stories)
			stories = this.data.stories[user.id] = [];

		if (!stories.includes(story))
			stories.push(story);

		await this.save();
		this.logger.info(this.getName(user), `updated ${this.pronouns.referTo(user).their} story '${chalk.magentaBright(story.name)}'`);
	}

	private async handleStoryQuery (message: CommandMessage, queryArgs: string[]) {
		const matchingStories = this.queryStories(queryArgs, message.author);
		if (!matchingStories.length)
			return this.reply(message, "I could not find a story matching the given data.")
				.then(reply => CommandResult.fail(message, reply));

		if (matchingStories.length > 1)
			return this.reply(message, `I found multiple stories matching the given data. Can you be more specific? All matches:\n${matchingStories.map(({ data, id }) => `- **${data.name}**  ·  ID: \`${id}\``).join("\n")}`)
				.then(reply => CommandResult.fail(message, reply));

		return this.data.stories[message.author.id].indexOf(matchingStories[0].data);
	}

	private queryStories (query: string[], user?: User | GuildMember) {
		query = query.map(term => term.toLowerCase());
		let stories: { data: IStory; id: string; }[];
		if (user)
			stories = this.data.stories[user.id]
				.map((data, id) => ({ data, id: `${user.id}/${id}` }));
		else
			stories = Object.entries(this.data.stories)
				.flatMap(([author, stories]) => stories.map((data, id) => ({ data, id: `${author}/${id}` })));

		return Strings.searchOnKey(query, stories, "name");
	}

	@Bound
	private generateStoryEmbed (story: IStory,) {
		const author = this.guild.members.cache.get(story.author);
		return new MessageEmbed()
			.setTitle(story.name)
			.setURL(story.scribble || story.otherURL || story.patreon)
			.setAuthor(author?.displayName, author?.user.avatarURL() || undefined, this.getAuthorURL(this.data.authors[author?.id!]))
			.setDescription(story.synopsis)
			.setThumbnail(story.thumbnail)
			.addField("Status", `${this.statusEmoji[story.status || "unknown"]} ${Strings.sentence(story.status || "unknown")}`)
			.addFields(
				(story.scribble || story.patreon || story.ao3 || story.otherURL) && { name: "\u200b", value: "__**Links**__" },
				story.scribble && { name: "Scribble Hub", value: story.scribble },
				story.patreon && { name: "Patreon", value: story.patreon },
				story.ao3 && { name: "Archive of Our Own", value: story.ao3 },
				story.otherURL && { name: "Other", value: story.otherURL },
			);
	}

	@Bound
	private generateAuthorEmbed (inUser: User | GuildMember): MessageEmbed | undefined {
		const user = inUser instanceof User ? inUser : inUser.user;
		const member = inUser instanceof GuildMember ? inUser : this.guild.members.cache.get(inUser.id);
		const author = this.data.authors[user.id];

		return author && new MessageEmbed()
			.setTitle(member?.displayName || user.username)
			.setURL(this.getAuthorURL(this.data.authors[member?.id!]))
			.setDescription(author.bio || "_This author prefers to remain elusive and mysterious..._")
			.setThumbnail(user.avatarURL() || undefined)
			.addFields(
				(author.scribble || author.patreon || author.ao3 || author.otherURL) && { name: "\u200b", value: "__**Links**__" },
				author.scribble && { name: "Scribble Hub", value: author.scribble },
				author.patreon && { name: "Patreon", value: author.patreon },
				author.ao3 && { name: "Archive of Our Own", value: author.ao3 },
				author.otherURL && { name: "Other", value: author.otherURL },
			);
	}

	private getAuthorURL (author?: IAuthor) {
		return author && (author.scribble
			|| author.patreon
			|| author.ao3
			|| author.otherURL);
	}

	private getStoriesBy (user: User | GuildMember) {
		return this.data.stories[user.id] || [];
	}

	private statusFromEmoji (emoji: Emoji | ReactionEmoji) {
		return Object.entries(this.statusEmoji)
			.find(([, e]) => e === emoji)
			?.[0] as keyof typeof Status | undefined;
	}
}
