import { DMChannel, Emoji, GroupDMChannel, Message, ReactionEmoji, RichEmbed, TextChannel, User } from "discord.js";
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
	content: string;
	fields: IField[];
	embed?: RichEmbed;
}

export class Paginator<T = any> {

	public static create<T extends string | undefined> (values: Iterable<T>, handler?: undefined): Paginator<T>;
	public static create<T extends IField | undefined> (values: Iterable<T>, handler?: undefined): Paginator<T>;
	public static create<T> (values: Iterable<T>, handler: (value: T) => string | undefined): Paginator<T>;
	public static create<T> (values: Iterable<T>, handler: (value: T) => IField | undefined): Paginator<T>;
	public static create<T> (values: Iterable<T>, handler: (value: T) => RichEmbed | undefined): Paginator<T>;
	public static create<T> (values: Iterable<T>, handler?: (value: T) => string | IField | RichEmbed | undefined): Paginator<T> {
		return new Paginator(values, handler);
	}

	public event = new EventEmitterAsync(this);

	private readonly values: any[];
	private readonly handler: ((value: any) => string | IField | RichEmbed | undefined) | undefined;
	private readonly otherOptions: [string | Emoji, string?][] = [];
	private pages?: IPage<T>[];
	private i = 0;
	private pageHeader?: string;
	private autoMerge = true;
	private cancelled = false;

	private constructor (values: Iterable<T>, handler?: (value: any) => string | IField | RichEmbed | undefined) {
		this.values = Array.from(values);
		this.handler = handler;
	}

	public setPageHeader (header: string) {
		this.pageHeader = header;
		return this;
	}

	public setNoAutoMerge () {
		this.autoMerge = false;
		return this;
	}

	public addOption (option?: string | Emoji | false | 0 | null, definition?: string) {
		if (option)
			this.otherOptions.push([option, definition]);
		return this;
	}

	public addOptions (...options: [string | Emoji, string?][]) {
		this.otherOptions.push(...options);
		return this;
	}

	public async reply (message: CommandMessage) {
		return this.send(message.channel, message.author, message);
	}

	public async send (channel: TextChannel | DMChannel | GroupDMChannel, inputUser?: User, commandMessage?: CommandMessage) {
		if (this.getSize() === 1) {
			const currentContent = this.get();
			let currentText: string;
			let currentEmbed = currentContent.embed ?? new RichEmbed()
				.setTitle(currentContent.title)
				.setDescription(currentContent.content)
				.addFields(...currentContent.fields);

			currentText = inputUser && !(channel instanceof DMChannel) ? `<@${inputUser.id}>` : "";

			if (commandMessage?.previous?.output[0])
				return commandMessage.previous?.output[0].edit(currentText, currentEmbed)
					.then(async result => {
						for (let i = 1; i < (commandMessage.previous?.output.length || 0); i++)
							commandMessage.previous?.output[i].delete();

						return result;
					});

			return channel.send(currentText, currentEmbed);
		}

		return channel instanceof DMChannel || channel instanceof GroupDMChannel ? this.sendDM(channel, inputUser, commandMessage)
			: this.sendServer(channel, inputUser, commandMessage);
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
		for (const value of this.values) {
			const content = this.handler ? this.handler(value) : value;
			if (!content)
				continue;

			const newField = IField.is(content) ? content : undefined;
			const richEmbed = content instanceof RichEmbed ? content : undefined;
			const newContent = newField || richEmbed ? "" : `\n\n${content}\n`;

			let currentPage = pages[pages.length - 1];

			const shouldMakeNewPage =
				richEmbed // the content is a rich embed
				|| !pages.length // no pages
				|| !this.autoMerge // automerge is turned off, so every single entry should be a new page
				|| (typeof content === "string"
					? currentPage.content.length + newContent.length > maxLength
					: currentPage.fields.length >= maxFields);

			if (shouldMakeNewPage)
				pages.push(currentPage = { title: this.pageHeader, content: "", fields: [], embed: richEmbed, originalValue: value });

			currentPage.content += newContent;
			if (newField)
				currentPage.fields.push(newField);
		}

		if (pages.length === 0)
			pages.push({ content: "...there is nothing here. 😭", fields: [], originalValue: undefined! });

		return this.pages = pages;
	}

	private async sendServer (channel: TextChannel | DMChannel | GroupDMChannel, inputUser?: User, commandMessage?: CommandMessage) {
		let resolved = false;
		return new Promise<Message>(async resolve => {
			let currentContent = this.get();
			let currentText: string;
			let currentEmbed = (currentContent.embed ?? new RichEmbed()
				.setTitle(currentContent.title)
				.setDescription(currentContent.content)
				.addFields(...currentContent.fields))
				.setFooter(this.getPageNumberText());

			currentText = inputUser ? `<@${inputUser.id}>` : "";

			let messagePromise: Promise<Message>;
			if (commandMessage?.previous?.output[0]) {
				messagePromise = commandMessage.previous.output[0].edit(currentText, currentEmbed);
				for (let i = 1; i < commandMessage.previous.output.length; i++)
					commandMessage.previous.output[i].delete();

			} else
				messagePromise = channel.send(currentText, currentEmbed) as Promise<Message>;

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
					await message.edit(currentText, currentEmbed?.setFooter(`${this.getPageNumberText()}. ${reaction ? "Interactable cancelled." : "Interactable timed out."}`));
					await message.clearReactions();
					// message.delete();
					// if (commandMessage?.deletable)
					// 	commandMessage.delete();
					return;
				}

				await this.handleReaction(reaction);
				if (this.cancelled)
					return;

				currentContent = this.get();
				currentEmbed = (currentContent.embed ?? new RichEmbed()
					.setTitle(currentContent.title)
					.setDescription(currentContent.content)
					.addFields(...currentContent.fields))
					.setFooter(this.getPageNumberText());

				message.edit(currentText, currentEmbed);
			}
		});
	}

	private async sendDM (channel: TextChannel | DMChannel | GroupDMChannel, inputUser?: User, commandMessage?: CommandMessage) {
		for (const previousMessage of commandMessage?.previous?.output || []) {
			previousMessage.deleted = true;
			await previousMessage.delete();
		}

		let resolved = false;
		return new Promise<Message>(async resolve => {
			while (true) {
				let currentContent = this.get();
				let currentText: string;
				let currentEmbed = (currentContent.embed ?? new RichEmbed()
					.setTitle(currentContent.title)
					.setDescription(currentContent.content)
					.addFields(...currentContent.fields))
					.setFooter(this.getPageNumberText());

				currentText = inputUser && !(channel instanceof DMChannel) ? `<@${inputUser.id}>` : "";

				const messagePromise = channel.send(currentText, currentEmbed) as Promise<Message>;
				if (!resolved) {
					resolved = true;
					resolve(messagePromise);
				}

				const message = await messagePromise;

				const reaction = await this.awaitReaction(message, inputUser);

				if (!reaction || reaction.name === PaginatorReaction.Cancel) {
					this.cancelled = true;
					await message.edit(currentText, currentEmbed?.setFooter(`${this.getPageNumberText()}. ${reaction ? "Interactable cancelled." : "Interactable timed out."}`));
					return;
				}

				message.deleted = true;
				await message.delete();

				await this.handleReaction(reaction);
				if (this.cancelled)
					return;
			}
		});
	}

	private async handleReaction (reaction: Emoji | ReactionEmoji) {
		if (reaction.name === PaginatorReaction.Prev)
			return this.prev();

		if (reaction.name === PaginatorReaction.Next)
			return this.next();

		return this.event.emit("reaction", this, reaction);
	}

	private async awaitReaction (message: Message, inputUser?: User, mode: "add" | "edit" = "add") {
		const reactions = [
			PaginatorReaction.Prev,
			PaginatorReaction.Next,
			...this.otherOptions.map(([emoji]) => emoji),
			PaginatorReaction.Cancel,
		];

		if (mode === "add")
			// no await is intentional
			this.addReactions(message, reactions);

		// this is so ugly lol
		const collected = await message.awaitReactions((r, user) =>
			(!inputUser ? user.id !== message.author.id : user.id === inputUser.id) && reactions.includes(r.emoji.name),
			{ max: 1, time: minutes(5) })
			.catch(() => { });

		if (!collected || !collected.size)
			return undefined;

		const reaction = collected.first();
		if (!(message.channel instanceof DMChannel || message.channel instanceof GroupDMChannel))
			await reaction.remove(inputUser);

		return reaction.emoji;
	}

	private async addReactions (message: Message, reactions: (string | Emoji)[]) {
		for (const reaction of reactions)
			if (!message.deleted)
				await message.react(reaction);
	}

	private getPageNumberText () {
		return `Page ${this.i + 1} of ${this.getPages().length}`;
	}
}