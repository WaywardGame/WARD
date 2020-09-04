import { DMChannel, Emoji, GuildMember, Message, ReactionEmoji, RichEmbed, User } from "discord.js";
import { Command, CommandMessage, CommandResult } from "../core/Api";
import { Paginator } from "../core/Paginatable";
import { Plugin } from "../core/Plugin";
import Bound from "../util/Bound";
import Enums from "../util/Enums";
import Strings from "../util/Strings";
import { minutes } from "../util/Time";

interface IStoryConfig {

}

interface IStory {
	author: string;
	name: string;
	synopsis: string;
	thumbnail?: string;
	scribble?: string;
	ao3?: string;
	tgst?: string;
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
	tgst?: string;
	otherURL?: string;
	bio?: string;
}

interface IStoryData {
	authors: Record<string, IAuthor>;
	stories: Record<string, IStory[]>;
}

export default class StoryPlugin extends Plugin<IStoryConfig, IStoryData> {

	public getDefaultConfig () {
		return {};
	}

	protected initData = () => ({ authors: {}, stories: {} });

	public getDefaultId () {
		return "stories";
	}

	private statusEmoji: Record<keyof typeof Status, Emoji>;

	public onStart () {
		this.statusEmoji = Object.fromEntries(Enums.keys(Status)
			.map(status => [status, this.guild.emojis.find(emoji => emoji.name === status)])) as Record<keyof typeof Status, Emoji>;
	}

	@Command(["author register", "author edit"])
	protected async onCommandAuthorWizard (message: CommandMessage) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "Please use this command in a DM with me so as to not spam the chat. Thanks!");
			return CommandResult.pass();
		}

		await this.clearReactions(message);
		await this.authorWizard(message);

		return CommandResult.pass();
	}

	@Command("author unregister")
	protected async onCommandAuthorUnregister (message: CommandMessage) {
		delete this.data.authors[message.author.id];
		await this.reply(message, "Your author profile has been unregistered. 😭");
		return CommandResult.pass();
	}

	// @Command("story unregister")
	// protected async onCommandStoryUnregister (message: CommandMessage, ...queryArgs: string[]) {
	// 	let storyId: number | undefined;
	// 	if (queryArgs.length) {
	// 		const matchingStories = this.queryStories(queryArgs, message.author);
	// 		if (!matchingStories.length)
	// 			return this.reply(message, "I could not find a story matching the given data.")
	// 				.then(reply => CommandResult.fail(message, reply));

	// 		if (matchingStories.length > 1)
	// 			return this.reply(message, "I found multiple stories matching the given data. Can you be more specific?")
	// 				.then(reply => CommandResult.fail(message, reply));

	// 		storyId = this.data.stories[message.author.id].indexOf(matchingStories[0]);
	// 	}

	// 	await this.reply(message, "I've unregistered the story");
	// 	return CommandResult.pass();
	// }

	@Command(["story register", "story edit"])
	protected async onCommandStoryRegister (message: CommandMessage, ...queryArgs: string[]) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "Please use this command in a DM with me so as to not spam the chat. Thanks!");
			return CommandResult.pass();
		}

		let storyId: number | undefined;
		if (queryArgs.length) {
			const matchingStories = this.queryStories(queryArgs, message.author);
			if (!matchingStories.length)
				return this.reply(message, "I could not find a story matching the given data.")
					.then(reply => CommandResult.fail(message, reply));

			if (matchingStories.length > 1)
				return this.reply(message, "I found multiple stories matching the given data. Can you be more specific?")
					.then(reply => CommandResult.fail(message, reply));

			storyId = this.data.stories[message.author.id].indexOf(matchingStories[0]);
		}

		await this.storyWizard(message, storyId);

		return CommandResult.pass();
	}

	@Command("story")
	protected async onCommandStoryQuery (message: CommandMessage, ...queryArgs: string[]) {
		Paginator.create(this.queryStories(queryArgs), this.generateStoryEmbed)
			.reply(message);

		return CommandResult.pass();
	}

	@Command("author")
	protected async onCommandAuthor (message: CommandMessage, queryMember?: string | GuildMember) {
		let member = queryMember instanceof GuildMember ? queryMember : message.member;

		if (queryMember && !(queryMember instanceof GuildMember)) {
			const result = this.validateFindResult(await this.findMember(queryMember));
			if (result.error !== undefined)
				return this.reply(message, result.error)
					.then(reply => CommandResult.fail(message, reply));

			member = result.member;
		}

		await this.clearReactions(message);

		const result = await this.promptReaction(this.generateAuthorEmbed(member))
			.addOption("📖", "View this author's stories")
			.addOption(member.id === message.author.id && "✏", "Edit your profile")
			.addCancelOption()
			.reply(message);

		if (result.response?.name === "📖") {
			message.previous = CommandResult.mid(message, result.message);
			return this.onCommandStories(message, member);
		}

		if (result.response?.name === "✏" && member.id === message.author.id) {
			message.previous = CommandResult.mid(message, result.message);
			return this.onCommandAuthorWizard(message);
		}

		return CommandResult.pass();
	}

	@Command("stories")
	protected async onCommandStories (message: CommandMessage, queryMember?: string | GuildMember) {
		let member = queryMember instanceof GuildMember ? queryMember : message.member;

		if (queryMember && !(queryMember instanceof GuildMember)) {
			const result = this.validateFindResult(await this.findMember(queryMember));
			if (result.error !== undefined)
				return this.reply(message, result.error)
					.then(reply => CommandResult.fail(message, reply));

			member = result.member;
		}

		await this.clearReactions(message);

		const stories = this.getStoriesBy(member);
		Paginator.create(stories, story => this.generateStoryEmbed(story, member))
			.addOption(member.id === message.author.id && "✏", "Edit story")
			.addOption("👤", "View author's profile")
			.event.subscribe("reaction", async (paginator: Paginator<IStory>, reaction: Emoji | ReactionEmoji) => {
				if (reaction.name !== "✏" && reaction.name !== "👤")
					return;

				paginator.cancel();

				if (reaction.name === "👤")
					this.onCommandAuthor(message, member);

				else if (member.id === message.author.id)
					this.storyWizard(message, stories.indexOf(paginator.get().originalValue));
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
			if (await this.yesOrNo("Oh! Seems like you haven't set up your author profile yet. Would you like to do that first?").reply(message))
				await this.authorWizard(message);
		}

		////////////////////////////////////
		// Name
		//

		let response = await this.prompter(`First up, please send the name of your story!`)
			.setDefaultValue(story.name)
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.name = response.content;

		////////////////////////////////////
		// Synopsis
		//

		response = await this.prompter(`Next, what would you like to be the synopsis of the story?`)
			.setDefaultValue(story.synopsis)
			.setDeletable()
			.setTimeout(minutes(20))
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.synopsis = response.content;

		////////////////////////////////////
		// Scribble
		//

		response = await this.prompter(`Next, we're going to get all the links for your story. Let's start with the Scribble Hub URL.`)
			.setDefaultValue(story.scribble)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.scribblehub.com") ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.scribble = response.content;

		////////////////////////////////////
		// Patreon
		//

		response = await this.prompter(`Do you have a link for the story on your Patreon?\n_(Hint: If you tag all chapters of a story with the same tag, you can click on that tag to get the link for it.)_`)
			.setDefaultValue(story.patreon)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.patreon.com") ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.patreon = response.content;

		////////////////////////////////////
		// Ao3
		//

		response = await this.prompter(`What about Ao3?`)
			.setDefaultValue(story.ao3)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "archiveofourown.org") ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.ao3 = response.content;

		////////////////////////////////////
		// TG Storytime
		//

		response = await this.prompter(`What about TG Storytime?`)
			.setDefaultValue(story.tgst)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.tgstorytime.com") ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.tgst = response.content;

		////////////////////////////////////
		// Other URL
		//

		response = await this.prompter(`Do you have the story on another site?`)
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

		response = await this.prompter(`Next, what would you like to be the thumbnail of the story? Must be a URL. _(Hint: If you want to use your Scribble Hub thumbnail, right click on it and hit "copy link address.")_`)
			.setDefaultValue(story.thumbnail)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content) ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Story wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			story.thumbnail = response.content;

		////////////////////////////////////
		// Status
		//

		const statusResult = await this.promptReaction("Next, what is the status of the story?")
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

		let response = await this.prompter("First, please send what you would you like to be in your bio.")
			.setDefaultValue(author.bio)
			.setDeletable()
			.reply(message);

		if (!response)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			author.bio = response.content;

		////////////////////////////////////
		// Scribble
		//

		response = await this.prompter("Next, what's your Scribble Hub URL?")
			.setDefaultValue(author.scribble)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.scribblehub.com") ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			author.scribble = response.content;

		////////////////////////////////////
		// Patreon
		//

		response = await this.prompter("What's your Patreon URL?")
			.setDefaultValue(author.patreon)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.patreon.com") ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			author.patreon = response.content;

		////////////////////////////////////
		// Ao3
		//

		response = await this.prompter("What's your Ao3 URL?")
			.setDefaultValue(author.ao3)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "archiveofourown.org") ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			author.ao3 = response.content;

		////////////////////////////////////
		// TG Storytime
		//

		response = await this.prompter("What's your TG Storytime URL?")
			.setDefaultValue(author.tgst)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content, "www.tgstorytime.com") ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			author.tgst = response.content;

		////////////////////////////////////
		// Other
		//

		response = await this.prompter("What about a profile on another website?")
			.setDefaultValue(author.otherURL)
			.setDeletable()
			.setValidator(message => Strings.isURL(message.content) ? true : "Not a valid URL.")
			.reply(message);

		if (!response)
			return this.reply(message, "Author wizard cancelled. Stop by again soon!");

		if (response instanceof Message)
			author.otherURL = response.content;

		////////////////////////////////////
		// Save
		//

		await this.registerAuthor(message.author, author);
		return this.reply(message, "Author registration created/updated. Thanks!");
	}

	private async registerAuthor (user: User | GuildMember, author: IAuthor) {
		this.data.authors[user.id] = author;
		await this.save();
	}

	private async registerStory (user: User | GuildMember, story: IStory) {
		let stories = this.data.stories[user.id];
		if (!stories)
			stories = this.data.stories[user.id] = [];

		if (!stories.includes(story))
			stories.push(story);

		return this.save();
	}

	private queryStories (query: string[], user?: User | GuildMember) {
		const regExpQuery = query.map(arg => new RegExp(`\\b${arg}\\b`, "i"));

		return (user ? this.data.stories[user.id] || [] : Object.values(this.data.stories).flat())
			.map(story => ({ story, value: regExpQuery.filter(regex => regex.test(story.name)).length }))
			.filter(({ value }) => value)
			.sort(({ value: a }, { value: b }) => b - a)
			.map(({ story }) => story);
	}

	@Bound
	private generateStoryEmbed (story: IStory, member = this.guild.members.get(story.author)) {
		return new RichEmbed()
			.setTitle(story.name)
			.setURL(story.scribble || story.otherURL || story.patreon)
			.setAuthor(member?.displayName, member?.user.avatarURL, this.getAuthorURL(this.data.authors[member?.id!]))
			.setDescription(story.synopsis)
			.setThumbnail(story.thumbnail)
			.addField("Status", `${this.statusEmoji[story.status || "unknown"]} ${Strings.sentence(story.status || "unknown")}`)
			.addFields(
				story.scribble && { name: "Scribble Hub", content: story.scribble },
				story.patreon && { name: "Patreon", content: story.patreon },
				story.ao3 && { name: "Archive of Our Own", content: story.ao3 },
				story.tgst && { name: "TG Storytime", content: story.tgst },
				story.otherURL && { name: "Other", content: story.otherURL },
			);
	}

	@Bound
	private generateAuthorEmbed (inUser: User | GuildMember) {
		const user = inUser instanceof User ? inUser : inUser.user;
		const member = inUser instanceof GuildMember ? inUser : this.guild.members.get(inUser.id);
		const author = this.data.authors[user.id];

		return new RichEmbed()
			.setTitle(member?.displayName || user.username)
			.setURL(this.getAuthorURL(this.data.authors[member?.id!]))
			.setDescription(author.bio)
			.setThumbnail(user.avatarURL)
			.addFields(
				author.scribble && { name: "Scribble Hub", content: author.scribble },
				author.patreon && { name: "Patreon", content: author.patreon },
				author.ao3 && { name: "Archive of Our Own", content: author.ao3 },
				author.tgst && { name: "TG Storytime", content: author.tgst },
				author.otherURL && { name: "Other", content: author.otherURL },
			);
	}

	private getAuthorURL (author?: IAuthor) {
		return author && (author.scribble
			|| author.patreon
			|| author.ao3
			|| author.tgst
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
