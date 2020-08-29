import { DMChannel, GroupDMChannel, Message, RichEmbed, TextChannel, User } from "discord.js";
import { minutes } from "../util/Time";

export default interface Paginatable<A extends any[]> {
	getPaginator (...args: A): Paginator;
}

enum PaginatorReaction {
	Prev = "◀",
	Next = "▶",
	Cancel = "❌",
}

export class Paginator {

	public static create<T extends string | undefined> (values: Iterable<T>, handler?: undefined): Paginator;
	public static create<T> (values: Iterable<T>, handler: (value: T) => string | undefined): Paginator;
	public static create<T> (values: Iterable<T>, handler?: (value: T) => string | undefined): Paginator {
		return new Paginator(values, handler);
	}

	private readonly values: any[];
	private readonly handler: ((value: any) => string | undefined) | undefined;
	private pages?: string[];
	private i = 0;
	private richEmbed: boolean | ((page: string) => RichEmbed) = true;
	private pageHeader = "Page **{page}** of **{total}**";

	private constructor (values: Iterable<any>, handler?: (value: any) => string | undefined) {
		this.values = Array.from(values);
		this.handler = handler;
	}

	public setRichEmbed (richEmbed?: boolean | ((page: string) => RichEmbed)) {
		this.richEmbed = richEmbed ?? true;
		return this;
	}

	public setPageHeader (header: string) {
		this.pageHeader = header;
		return this;
	}

	public async reply (message: Message) {
		return this.send(message.channel, message.author);
	}

	public async send (channel: TextChannel | DMChannel | GroupDMChannel, inputUser?: User) {
		if (this.getSize() === 1) {
			const content = this.get();
			return typeof content === "string" ? channel.send(content) : channel.send({ embed: content });
		}

		return channel instanceof DMChannel || channel instanceof GroupDMChannel ? this.sendDM(channel, inputUser)
			: this.sendServer(channel, inputUser);
	}

	protected get () {
		const pages = this.getPages();
		return this.richEmbed ? new RichEmbed().setDescription(pages[this.i]) : pages[this.i];
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
		let pages: string[] = [];
		for (const value of this.values) {
			const content = this.handler ? this.handler(value) : value;
			if (!content)
				continue;

			const newContent = `\n\n${content}\n`;
			if (!pages.length || pages[pages.length - 1].length + newContent.length > maxLength)
				pages.push(this.pageHeader);

			pages[pages.length - 1] += newContent;
		}

		pages = pages.map((page, i) => page.replace(/{page}/g, `${i + 1}`).replace(/{total}/g, `${pages.length}`));

		if (pages.length === 1)
			// if there's only one page, don't show the page count
			pages[0] = pages[0].slice(pages[0].indexOf("\n"));

		if (pages.length === 0)
			pages.push("...there is nothing here. 😭");

		return this.pages = pages;
	}

	private async sendServer (channel: TextChannel | DMChannel | GroupDMChannel, inputUser?: User) {
		let resolved = false;
		return new Promise<Message>(async resolve => {
			let currentText = this.get();
			let currentEmbed: RichEmbed | undefined;
			if (typeof currentText !== "string")
				currentEmbed = currentText, currentText = inputUser ? `<@${inputUser.id}>` : "";

			const messagePromise = channel.send(currentText, currentEmbed) as Promise<Message>;
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
					message.delete();
					return;
				}

				this.paginate(reaction);

				currentText = this.get();
				currentEmbed = undefined;
				if (typeof currentText !== "string")
					currentEmbed = currentText, currentText = inputUser ? `<@${inputUser.id}>` : "";

				message.edit(currentText, currentEmbed);
			}
		});
	}

	private async sendDM (channel: TextChannel | DMChannel | GroupDMChannel, inputUser?: User) {
		let resolved = false;
		return new Promise<Message>(async resolve => {
			while (true) {
				let currentText = this.get();
				let currentEmbed: RichEmbed | undefined;
				if (typeof currentText !== "string")
					currentEmbed = currentText, currentText = inputUser ? `<@${inputUser.id}>` : "";

				const messagePromise = channel.send(currentText, currentEmbed) as Promise<Message>;
				if (!resolved) {
					resolved = true;
					resolve(messagePromise);
				}

				const message = await messagePromise;

				const reaction = await this.awaitReaction(message, inputUser);

				message.delete();

				if (!reaction || reaction === PaginatorReaction.Cancel)
					return;

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
			for (const reaction of reactions)
				await message.react(reaction);

		// this is so ugly lol
		const collected = await message.awaitReactions((r, user) =>
			(!inputUser ? user.id !== message.author.id : user.id === inputUser.id) && reactions.includes(r.emoji.name),
			{ max: 1, time: minutes(5) })
			.catch(() => { });

		if (!collected)
			return undefined;

		const reaction = collected.first();
		if (!(message.channel instanceof DMChannel || message.channel instanceof GroupDMChannel))
			await reaction.remove(inputUser);

		return reaction.emoji.name as PaginatorReaction;
	}
}