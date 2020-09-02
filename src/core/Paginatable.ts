import { DMChannel, GroupDMChannel, Message, RichEmbed, TextChannel, User } from "discord.js";
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

interface IPage {
	title?: string;
	content: string;
	fields: IField[];
}

export class Paginator {

	public static create<T extends string | undefined> (values: Iterable<T>, handler?: undefined): Paginator;
	public static create<T extends IField | undefined> (values: Iterable<T>, handler?: undefined): Paginator;
	public static create<T> (values: Iterable<T>, handler: (value: T) => string | undefined): Paginator;
	public static create<T> (values: Iterable<T>, handler: (value: T) => IField | undefined): Paginator;
	public static create<T> (values: Iterable<T>, handler?: (value: T) => string | IField | undefined): Paginator {
		return new Paginator(values, handler);
	}

	private readonly values: any[];
	private readonly handler: ((value: any) => string | IField | undefined) | undefined;
	private pages?: IPage[];
	private i = 0;
	private pageHeader?: string;
	private autoMerge = true;

	private constructor (values: Iterable<any>, handler?: (value: any) => string | IField | undefined) {
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

	public async reply (message: CommandMessage) {
		return this.send(message.channel, message.author, message);
	}

	public async send (channel: TextChannel | DMChannel | GroupDMChannel, inputUser?: User, commandMessage?: CommandMessage) {
		if (this.getSize() === 1) {
			const currentContent = this.get();
			let currentText: string;
			let currentEmbed = new RichEmbed()
				.setTitle(currentContent.title)
				.setDescription(currentContent.content);

			currentText = inputUser ? `<@${inputUser.id}>` : "";

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

	protected get () {
		return this.getPages()[this.i];
	}

	protected next () {
		this.i++;
		if (this.i >= this.getPages().length)
			this.i = 0;
	}

	protected prev () {
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
		let pages: IPage[] = [];
		for (const value of this.values) {
			const content = this.handler ? this.handler(value) : value;
			if (!content)
				continue;

			const newField = IField.is(content) ? content : undefined;
			const newContent = newField ? "" : `\n\n${content}\n`;

			let currentPage = pages[pages.length - 1];

			const shouldMakeNewPage =
				!pages.length // no pages
				|| !this.autoMerge // automerge is turned off, so every single entry should be a new page
				|| (typeof content === "string"
					? currentPage.content.length + newContent.length > maxLength
					: currentPage.fields.length >= maxFields);

			if (shouldMakeNewPage)
				pages.push(currentPage = { title: this.pageHeader, content: "", fields: [] });

			currentPage.content += newContent;
			if (newField)
				currentPage.fields.push(newField);
		}

		if (pages.length === 0)
			pages.push({ content: "...there is nothing here. 😭", fields: [] });

		return this.pages = pages;
	}

	private async sendServer (channel: TextChannel | DMChannel | GroupDMChannel, inputUser?: User, commandMessage?: CommandMessage) {
		let resolved = false;
		return new Promise<Message>(async resolve => {
			let currentContent = this.get();
			let currentText: string;
			let currentEmbed = new RichEmbed()
				.setTitle(currentContent.title)
				.setDescription(currentContent.content)
				.addFields(...currentContent.fields)
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

				if (!reaction || reaction === PaginatorReaction.Cancel) {
					await message.edit(currentText, currentEmbed?.setFooter(`${this.getPageNumberText()}. ${reaction ? "Interactable cancelled." : "Interactable timed out."}`));
					await message.clearReactions();
					// message.delete();
					// if (commandMessage?.deletable)
					// 	commandMessage.delete();
					return;
				}

				this.paginate(reaction);

				currentContent = this.get();
				currentEmbed = new RichEmbed()
					.setTitle(currentContent.title)
					.setDescription(currentContent.content)
					.addFields(...currentContent.fields)
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
				let currentEmbed = new RichEmbed()
					.setTitle(currentContent.title)
					.setDescription(currentContent.content)
					.addFields(...currentContent.fields)
					.setFooter(this.getPageNumberText());

				currentText = inputUser && !(channel instanceof DMChannel) ? `<@${inputUser.id}>` : "";

				const messagePromise = channel.send(currentText, currentEmbed) as Promise<Message>;
				if (!resolved) {
					resolved = true;
					resolve(messagePromise);
				}

				const message = await messagePromise;

				const reaction = await this.awaitReaction(message, inputUser);

				if (!reaction || reaction === PaginatorReaction.Cancel) {
					await message.edit(currentText, currentEmbed?.setFooter(`${this.getPageNumberText()}. ${reaction ? "Interactable cancelled." : "Interactable timed out."}`));
					return;
				}

				message.deleted = true;
				await message.delete();
				this.paginate(reaction);
			}
		});
	}

	private paginate (reaction: PaginatorReaction.Prev | PaginatorReaction.Next) {
		if (reaction === PaginatorReaction.Prev)
			this.prev();
		else
			this.next();
	}

	private async awaitReaction (message: Message, inputUser?: User, mode: "add" | "edit" = "add") {
		const reactions = [PaginatorReaction.Prev, PaginatorReaction.Next, PaginatorReaction.Cancel];

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

		return reaction.emoji.name as PaginatorReaction;
	}

	private async addReactions (message: Message, reactions: string[]) {
		for (const reaction of reactions)
			if (!message.deleted)
				await message.react(reaction);
	}

	private getPageNumberText () {
		return `Page ${this.i + 1} of ${this.getPages().length}`;
	}
}