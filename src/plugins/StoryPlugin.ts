import chalk from "chalk";
import { DMChannel, Emoji, GuildMember, Message, ReactionEmoji, RichEmbed, User } from "discord.js";
import { Command, CommandMessage, CommandResult } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Paginator } from "../core/Paginatable";
import { Plugin } from "../core/Plugin";
import Arrays from "../util/Arrays";
import Bound from "../util/Bound";
import Enums from "../util/Enums";
import Strings from "../util/Strings";
import { minutes } from "../util/Time";

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
}

interface IStoryData {
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
}

export default class StoryPlugin extends Plugin<IStoryConfig, IStoryData> {

	public getDefaultConfig () {
		return {};
	}

	protected initData = () => ({ authors: {}, stories: {} });

	public getDefaultId () {
		return "stories";
	}

	public getDescription () {
		return "A plugin for sharing your stories!";
	}

	private statusEmoji: Record<keyof typeof Status, Emoji>;

	public onStart () {
		this.statusEmoji = Object.fromEntries(Enums.keys(Status)
			.map(status => [status, this.guild.emojis.find(emoji => emoji.name === status)])) as Record<keyof typeof Status, Emoji>;
	}

	private readonly help = () => new HelpContainerPlugin()
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
				.setOptional()));

	@Command(["help stories", "stories help"])
	protected async commandHelp (message: CommandMessage) {
		this.reply(message, this.help());
		return CommandResult.pass();
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
		this.logger.info(this.getName(message.author), `removed ${this.getPronouns(message.author).their} profile`);
		await this.reply(message, "Your author profile has been unregistered. 😭");
		return CommandResult.pass();
	}

	@Command(["story register", "story edit"])
	protected async onCommandStoryRegister (message: CommandMessage, ...queryArgs: string[]) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "Please use this command in a DM with me so as to not spam the chat. Thanks!");
			return CommandResult.pass();
		}

		const storyId = await this.handleStoryQuery(message, queryArgs);
		if (typeof storyId !== "number")
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
		Paginator.create(this.queryStories(queryArgs).map(({ story }) => story), this.generateStoryEmbed)
			.reply(message);

		return CommandResult.pass();
	}

	@Command("author")
	protected async onCommandAuthor (message: CommandMessage, queryMember?: string | GuildMember) {
		let members: Iterable<GuildMember> = [queryMember instanceof GuildMember ? queryMember : message.member];

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
		return this.onCommandStories(message, this.guild.members.get(message.author.id));
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

	private async storyWizard (message: CommandMessage, storyId?: number) {
		const story: Partial<IStory> = storyId !== undefined ? this.data.stories[message.author.id]?.[storyId] : { author: message.author.id };

		if (!story)
			return this.logger.error("Failed to retrieve story for story wizard. Who did this!!!");

		await this.reply(message, `Welcome to the amazing, helpful, one-of-a-kind **story wizard** (or witch)! 🧙🏻‍♂️🧙🏻‍♀️\n\n_Currently ${storyId !== undefined ? `editing story '${story.name}'` : "creating a new story"}!_`);

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

		let response = await this.prompter(`First up, please **send the name of your story!**`)
			.setDefaultValue(story.name)
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		response.apply(story, "name");

		////////////////////////////////////
		// Synopsis
		//

		response = await this.prompter(`Next, what would you like to be the **synopsis** of the story?`)
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

		response = await this.prompter(`Next, we're going to get all the links for your story. Let's start with the **Scribble Hub URL**.`)
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

		response = await this.prompter(`Do you have a link for the story on your **Patreon**?\n_(Hint: If you tag all chapters of a story with the same tag, you can click on that tag to get the link for it.)_`)
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

		response = await this.prompter(`What about **Ao3**?`)
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

		response = await this.prompter(`Do you have the story on **another site?** _(IE, not Scribble Hub, not Patreon, not Ao3, not TGST)_`)
			.setDefaultValue(story.otherURL)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content) ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.otherURL = response.content;

		////////////////////////////////////
		// Thumbnail
		//

		response = await this.prompter(`Next, what would you like to be the **thumbnail** of the story? **Must be a URL.** _(Hint: If you want to use your Scribble Hub thumbnail, right click on it and hit "copy link address.")_`)
			.setDefaultValue(story.thumbnail)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content) ? true : "Not a valid URL.")
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		response.apply(story, "thumbnail");

		////////////////////////////////////
		// Status
		//

		const statusResult = await this.promptReaction("Next, what is the **status** of the story?")
			.addOptions(...Enums.keys(Status).map(status => [this.statusEmoji[status], Strings.sentence(status)] as const))
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

		let response = await this.prompter("First, please **send what you would you like to be in your bio**.")
			.setDefaultValue(author.bio)
			.setDeletable()
			.reply(message);

		if (response.cancelled)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		response.apply(author, "bio");

		////////////////////////////////////
		// Scribble
		//

		response = await this.prompter("Next, what's your **Scribble Hub URL**?")
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

		response = await this.prompter("What's your **Patreon URL**?")
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

		response = await this.prompter("What's your **Ao3 URL**?")
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

		response = await this.prompter("What about a profile on **another website**? _(IE, not Scribble Hub, not Patreon, not Ao3, not TGST)_")
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

		await this.registerAuthor(message.author, author);

		return this.reply(message, "Author registration created/updated. Thanks!");
	}

	private async registerAuthor (user: User | GuildMember, author: IAuthor) {
		this.data.authors[user.id] = author;
		await this.save();
		this.logger.info(this.getName(user), `updated ${this.getPronouns(user).their} profile`);
	}

	private async registerStory (user: User | GuildMember, story: IStory) {
		let stories = this.data.stories[user.id];
		if (!stories)
			stories = this.data.stories[user.id] = [];

		if (!stories.includes(story))
			stories.push(story);

		await this.save();
		this.logger.info(this.getName(user), `updated ${this.getPronouns(user).their} story '${chalk.magentaBright(story.name)}'`);
	}

	private async handleStoryQuery (message: CommandMessage, queryArgs: string[]) {
		const matchingStories = this.queryStories(queryArgs, message.author);
		if (!matchingStories.length)
			return this.reply(message, "I could not find a story matching the given data.")
				.then(reply => CommandResult.fail(message, reply));

		if (matchingStories.length > 1)
			return this.reply(message, `I found multiple stories matching the given data. Can you be more specific? All matches:\n${matchingStories.map(({ story, id }) => `- **${story.name}**  ·  ID: \`${id}\``).join("\n")}`)
				.then(reply => CommandResult.fail(message, reply));

		return this.data.stories[message.author.id].indexOf(matchingStories[0].story);
	}

	private queryStories (query: string[], user?: User | GuildMember) {
		query = query.map(term => term.toLowerCase());
		let stories: { story: IStory; id: string; }[];
		if (user)
			stories = this.data.stories[user.id]
				.map((story, id) => ({ story, id: `${user.id}/${id}` }));
		else
			stories = Object.entries(this.data.stories)
				.flatMap(([author, stories]) => stories.map((story, id) => ({ story, id: `${author}/${id}` })));

		return stories
			.map(({ story, id }) => ({ story, id, value: this.getQueryValue(story, id, query) }))
			.filter(({ value }) => value)
			.sort(({ value: a }, { value: b }) => b - a);
	}

	private getQueryValue (story: IStory, id: string, query: string[]) {
		const lowercase = story.name.toLowerCase();
		const hash = Strings.hash(lowercase);

		let nameSearch = story[SYMBOL_STORY_NAME_SEARCH_CACHE];
		if (!nameSearch || nameSearch.hash !== hash) {
			nameSearch = story[SYMBOL_STORY_NAME_SEARCH_CACHE] = {
				hash,
				terms: lowercase.split(/\s+/g),
			};
		}

		let value = 0;
		for (const queryTerm of query)
			if (queryTerm === id)
				value = 10000;
			else if (!nameSearch.terms.includes(queryTerm))
				return 0;

		return value + nameSearch.terms.reduce((prev, curr) => prev + (query.includes(curr) ? 100 : -1), 0);
	}

	@Bound
	private generateStoryEmbed (story: IStory,) {
		const author = this.guild.members.get(story.author);
		return new RichEmbed()
			.setTitle(story.name)
			.setURL(story.scribble || story.otherURL || story.patreon)
			.setAuthor(author?.displayName, author?.user.avatarURL, this.getAuthorURL(this.data.authors[author?.id!]))
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
	private generateAuthorEmbed (inUser: User | GuildMember): RichEmbed | undefined {
		const user = inUser instanceof User ? inUser : inUser.user;
		const member = inUser instanceof GuildMember ? inUser : this.guild.members.get(inUser.id);
		const author = this.data.authors[user.id];

		return author && new RichEmbed()
			.setTitle(member?.displayName || user.username)
			.setURL(this.getAuthorURL(this.data.authors[member?.id!]))
			.setDescription(author.bio || "_This author prefers to remain elusive and mysterious..._")
			.setThumbnail(user.avatarURL)
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
