import { ColorResolvable, DMChannel, Emoji, GuildEmoji, Message, MessageEmbed, NewsChannel, ReactionEmoji, TextChannel, User } from "discord.js";
import { EventEmitterAsync } from "../util/Async";
import { minutes } from "../util/Time";
import { CommandMessage, IField } from "./Api";

export default interface Paginatable<A extends any[]> {
	getPaginator (...args: A): Paginator;
}

enum PaginatorReaction {
	Prev = "◀",
	Next = "▶",
	Cancel = "❌",
}

interface IPage<T = any> {
	originalValue: T;
	title?: string;
	description?: string;
	color?: ColorResolvable;
	content: string;
	fields: IField[];
	embed?: MessageEmbed;
}

export class Paginator<T = any> {

	public static create<T extends string | undefined> (values: Iterable<T>, handler?: undefined): Paginator<T>;
	public static create<T extends IField | undefined> (values: Iterable<T>, handler?: undefined): Paginator<T>;
	public static create<T> (values: Iterable<T>, handler: (value: T, paginator: Paginator<T>, index: number) => string | undefined): Paginator<T>;
	public static create<T> (values: Iterable<T>, handler: (value: T, paginator: Paginator<T>, index: number) => IField | undefined): Paginator<T>;
	public static create<T> (values: Iterable<T>, handler: (value: T, paginator: Paginator<T>, index: number) => MessageEmbed | undefined): Paginator<T>;
	public static create<T> (values: Iterable<T>, handler?: (value: T, paginator: Paginator<T>, index: number) => string | IField | MessageEmbed | undefined): Paginator<T> {
		return new Paginator(values, handler);
	}

	public event = new EventEmitterAsync(this);

	private readonly values: any[];
	private readonly handler: ((value: any, paginator: Paginator<T>, index: number) => string | IField | MessageEmbed | undefined) | undefined;
	private readonly otherOptions: [GetterOr<string | Emoji | false | "" | 0 | null, [IPage<T>]>, string?][] = [];
	private pages?: IPage<T>[];
	private i = 0;
	private pageHeader?: string;
	private pageDescription?: string;
	private autoMerge = true;
	private cancelled = false;
	private startOnLastPage = false;
	private noContentMessage = "...there is nothing here. 😭";
	private color?: ColorResolvable;
	private shouldDeleteOnUseOption?: (option: GuildEmoji | ReactionEmoji) => boolean;
	private timeout?: number;

	public get page () {
		return this.i;
	}

	private constructor (values: Iterable<T>, handler?: (value: any, paginator: Paginator<T>, index: number) => string | IField | MessageEmbed | undefined) {
		this.values = Array.from(values);
		this.handler = handler;
	}

	public setPageHeader (header: string) {
		this.pageHeader = header;
		return this;
	}

	public setPageDescription (description?: string) {
		this.pageDescription = description;
		return this;
	}

	public setStartOnLastPage () {
		this.startOnLastPage = true;
		return this;
	}

	public setNoAutoMerge () {
		this.autoMerge = false;
		return this;
	}

	public setNoContentMessage (message: string) {
		this.noContentMessage = message;
		return this;
	}

	public setColor (color: ColorResolvable) {
		this.color = color;
		return this;
	}

	public addOption (option?: GetterOr<string | Emoji | false | "" | 0 | null, [IPage<T>]>, definition?: string) {
		if (option)
			this.otherOptions.push([option, definition]);
		return this;
	}

	public setShouldDeleteOnUseOption (shouldDelete: (option: GuildEmoji | ReactionEmoji) => boolean) {
		this.shouldDeleteOnUseOption = shouldDelete;
		return this;
	}

	public addOptions (...options: [GetterOr<string | Emoji | false | "" | 0 | null, [IPage<T>]>, string?][]) {
		this.otherOptions.push(...options.filter(([option]) => option));
		return this;
	}

	public setTimeout (timeout: number) {
		this.timeout = timeout;
		return this;
	}

	public async reply (message: CommandMessage) {
		return this.send(message.channel, message.author, message);
	}

	public async send (channel: TextChannel | DMChannel | NewsChannel | User, inputUser?: User, commandMessage?: CommandMessage) {
		// if (this.getSize() === 1) {
		// 	const currentContent = this.get();
		// 	let currentText: string;
		// 	let currentEmbed = currentContent.embed ?? new MessageEmbed()
		// 		.setTitle(currentContent.title)
		// 		.setDescription(currentContent.content)
		// 		.addFields(...currentContent.fields);

		// 	currentText = inputUser && !(channel instanceof DMChannel) ? `<@${inputUser.id}>` : "";

		// 	if (commandMessage?.previous?.output[0])
		// 		return commandMessage.previous?.output[0].edit(currentText, currentEmbed)
		// 			.then(async result => {
		// 				for (let i = 1; i < (commandMessage.previous?.output.length || 0); i++)
		// 					commandMessage.previous?.output[i].delete();

		// 				return result;
		// 			});

		// 	return channel.send(currentText, currentEmbed);
		// }

		return channel instanceof DMChannel || channel instanceof User ? this.sendDM(channel, inputUser, commandMessage)
			: this.sendServer(channel, inputUser, commandMessage);
	}

	public async sendAndAwaitReaction (channel: TextChannel | DMChannel | NewsChannel | User, inputUser: User | undefined, commandMessage: CommandMessage | undefined, reactionFilter: (reaction: Emoji) => boolean) {
		const { promise } = this.getReactionPromise(reactionFilter);
		await this.send(channel, inputUser, commandMessage);
		return promise;
	}

	public async replyAndAwaitReaction (message: CommandMessage, reactionFilter: (reaction: Emoji) => boolean) {
		const { promise } = this.getReactionPromise(reactionFilter);
		await this.reply(message);
		return promise;
	}

	private getReactionPromise (reactionFilter: (reaction: Emoji) => boolean) {
		type Result = {
			cancelled: true;
			reaction?: undefined;
			page?: undefined;
		}
			| {
				cancelled: false;
				reaction: Emoji | ReactionEmoji;
				page?: IPage<T>;
			};

		const promise = new Promise<Result>(resolve => {
			this.event.subscribe("reaction", (paginator: this, reaction: Emoji | ReactionEmoji, responseMessage: Message) => {
				if (reactionFilter(reaction)) {
					resolve({ cancelled: false, reaction, page: this.get() });
					this.cancelled = true;
				}
			});
			this.event.subscribe("cancel", () => resolve({ cancelled: true }));
		});

		return { promise };
	}

	public cancel () {
		this.cancelled = true;
		return this;
	}

	public get () {
		return this.getPages()[this.i];
	}

	public next () {
		this.i++;
		if (this.i >= this.getPages().length)
			this.i = 0;
	}

	public prev () {
		if (this.i <= 0)
			this.i = this.getPages().length;

		this.i--;
	}

	protected getSize () {
		return this.getPages().length;
	}

	private getPages () {
		if (this.pages)
			return this.pages;

		const maxLength = 1400;
		const maxFields = 24;
		let pages: IPage<T>[] = [];
		let index = 0;
		for (const value of this.values) {
			const content = this.handler ? this.handler(value, this, index) : value;
			if (!content)
				continue;

			index++;

			const newField = IField.is(content) ? content : undefined;
			const messageEmbed = content instanceof MessageEmbed ? content : undefined;
			const newContent = newField || messageEmbed ? "" : `\n\n${content}\n`;

			let currentPage = pages[pages.length - 1];

			const shouldMakeNewPage =
				messageEmbed // the content is a rich embed
				|| !pages.length // no pages
				|| !this.autoMerge // automerge is turned off, so every single entry should be a new page
				|| (typeof content === "string"
					? currentPage.content.length + newContent.length > maxLength
					: currentPage.fields.length >= maxFields);

			if (shouldMakeNewPage)
				pages.push(currentPage = {
					title: this.pageHeader,
					description: this.pageDescription,
					color: this.color,
					content: "",
					fields: [],
					embed: messageEmbed,
					originalValue: value,
				});

			currentPage.content += newContent;
			if (newField)
				currentPage.fields.push(newField);
		}

		if (pages.length === 0)
			pages.push({
				title: this.pageHeader,
				description: this.pageDescription,
				color: this.color,
				content: this.noContentMessage,
				fields: [],
				originalValue: undefined!,
			});

		this.i = this.startOnLastPage ? pages.length - 1 : 0;
		return this.pages = pages;
	}

	private async sendServer (channel: TextChannel | DMChannel | NewsChannel, inputUser?: User, commandMessage?: CommandMessage) {
		let resolved = false;
		return new Promise<Message>(async resolve => {
			let currentContent = this.get();
			let currentEmbed = (currentContent.embed ?? new MessageEmbed()
				.setTitle(currentContent.title)
				.setDescription(currentContent.content || currentContent.description)
				.setColor(currentContent.color)
				.addFields(...currentContent.fields));

			if (!currentEmbed.footer || currentEmbed.author)
				currentEmbed.setFooter(this.getPageNumberText());
			else
				currentEmbed.setAuthor(this.getPageNumberText());

			let messagePromise: Promise<Message>;
			if (commandMessage?.previous?.output[0]) {
				messagePromise = commandMessage.previous.output[0].edit(undefined, currentEmbed);
				for (let i = 1; i < commandMessage.previous.output.length; i++)
					commandMessage.previous.output[i].delete();

			} else
				messagePromise = channel.send(undefined, { embed: currentEmbed, replyTo: commandMessage }) as Promise<Message>;

			if (!resolved) {
				resolved = true;
				resolve(messagePromise);
			}

			let reacted = false;
			const message = await messagePromise;

			while (true) {
				const reaction = await this.awaitReaction(message, inputUser, reacted ? "edit" : "add");
				reacted = true;

				if (!reaction || reaction.name === PaginatorReaction.Cancel) {
					this.cancelled = true;
					await message.edit("", currentEmbed);
					await message.reactions.removeAll();
					// message.delete();
					// if (commandMessage?.deletable)
					// 	commandMessage.delete();
					this.event.emit("cancel", this);
					return;
				}

				await this.handleReaction(reaction, message);
				if (this.cancelled) {
					this.event.emit("cancel", this);
					return;
				}

				currentContent = this.get();
				currentEmbed = (currentContent.embed ?? new MessageEmbed()
					.setTitle(currentContent.title)
					.setDescription(currentContent.content || currentContent.description)
					.setColor(currentContent.color)
					.addFields(...currentContent.fields));

				if (!currentEmbed.footer || currentEmbed.author)
					currentEmbed.setFooter(this.getPageNumberText());
				else
					currentEmbed.setAuthor(this.getPageNumberText());

				message.edit(undefined, currentEmbed);
			}
		});
	}

	private async sendDM (channel: TextChannel | DMChannel | NewsChannel | User, inputUser?: User, commandMessage?: CommandMessage) {
		for (const previousMessage of commandMessage?.previous?.output || [])
			await previousMessage.delete();

		let resolved = false;
		return new Promise<Message>(async resolve => {
			while (true) {
				let currentContent = this.get();
				let currentEmbed = (currentContent.embed ?? new MessageEmbed()
					.setTitle(currentContent.title)
					.setDescription(currentContent.content || currentContent.description)
					.setColor(currentContent.color)
					.addFields(...currentContent.fields));

				if (!currentEmbed.footer || currentEmbed.author)
					currentEmbed.setFooter(this.getPageNumberText());
				else
					currentEmbed.setAuthor(this.getPageNumberText());

				const messagePromise = channel.send(undefined, { embed: currentEmbed, replyTo: commandMessage }) as Promise<Message>;
				if (!resolved) {
					resolved = true;
					resolve(messagePromise);
				}

				const message = await messagePromise;

				const reaction = await this.awaitReaction(message, inputUser);

				if (!reaction || reaction.name === PaginatorReaction.Cancel) {
					this.cancelled = true;
					this.event.emit("cancel", this);
					return;
				}

				if (this.shouldDeleteOnUseOption?.(reaction) ?? true)
					await message.delete();

				await this.handleReaction(reaction, message);
				if (this.cancelled) {
					this.event.emit("cancel", this);
					return;
				}
			}
		});
	}

	private async handleReaction (reaction: Emoji | ReactionEmoji, responseMessage: Message) {
		if (reaction.name === PaginatorReaction.Prev)
			return this.prev();

		if (reaction.name === PaginatorReaction.Next)
			return this.next();

		return this.event.emit("reaction", this, reaction, responseMessage);
	}

	private async awaitReaction (message: Message, inputUser?: User, mode: "add" | "edit" = "add") {
		const otherOptionReactions = this.otherOptions.map(([emoji]) => typeof emoji === "function" ? emoji(this.get()) : emoji)
			.map(emoji => typeof emoji === "string" || emoji instanceof GuildEmoji ? emoji : undefined)
			.filterNullish();

		const reactions = [
			...this.pages?.length !== 1 ? [PaginatorReaction.Prev, PaginatorReaction.Next] : [],
			...otherOptionReactions,
			...this.pages?.length !== 1 || otherOptionReactions.length ? [PaginatorReaction.Cancel] : [],
		];

		if (!reactions)
			return undefined;

		if (mode !== "add") {
			// if this page's reactions are invalid, we clear them and add them again
			const currentReactions = [...message.reactions.cache.values()].map(react => react.emoji.name);
			const newReactions = reactions.map(react => typeof react === "string" ? react : react.name);
			if (currentReactions.length !== newReactions.length || currentReactions.some(r => !newReactions.includes(r))) {
				await message.reactions.removeAll();
				mode = "add";
			}
		}

		if (mode === "add")
			// no await is intentional
			this.addReactions(message, reactions);

		// this is so ugly lol
		const collected = await message.awaitReactions((r, user) =>
			(!inputUser ? user.id !== message.author.id : user.id === inputUser.id) && reactions.includes(r.emoji.name),
			{ max: 1, time: this.timeout ?? minutes(5) })
			.catch(() => { });

		if (!collected || !collected.size)
			return undefined;

		const reaction = collected.first();
		if (!(message.channel instanceof DMChannel))
			await reaction?.users.remove(inputUser);

		return reaction?.emoji;
	}

	private async addReactions (message: Message, reactions: (string | GuildEmoji)[]) {
		for (const reaction of reactions)
			if (!message.deleted)
				await message.react(reaction);
	}

	private getPageNumberText () {
		const length = this.getPages().length;
		return length < 2 ? undefined : `Page ${this.i + 1} of ${length}`;
	}
}