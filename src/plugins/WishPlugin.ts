import Stream from "@wayward/goodstream";
import { DMChannel, Emoji, Message, MessageEmbed, ReactionEmoji } from "discord.js";
import { Command, CommandMessage, CommandResult, IField } from "../core/Api";
import { Paginator } from "../core/Paginatable";
import { Plugin } from "../core/Plugin";
import Strings from "../util/Strings";
import { hours } from "../util/Time";

export interface IWishParticipant {
	wish: string;
	wishGranting: string;
	canPinch?: boolean;
	granter?: string;
	gift?: {
		message?: string;
		url: string;
	}
}

export interface IWishConfig {
	organiser: string;
	participant?: string;
}

export enum WishStage {
	making,
	matching,
	granting,
	pinchGranting,
	ended,
}

export interface IWishData {
	stage: keyof typeof WishStage;
	participants: Record<string, IWishParticipant | undefined>;
}

export default class WishPlugin extends Plugin<IWishConfig, IWishData> {
	public getDefaultId () {
		return "wish";
	}

	public shouldExist (config: unknown) {
		return !!config;
	}

	public initData = () => ({ participants: {}, stage: "making" as const });

	@Command("wish message wisher")
	protected async onMessageWisher (message: CommandMessage, ...text: string[]) {
		if (WishStage[this.data.stage] < WishStage.granting) {
			this.reply(message, "Messages can not yet be sent.");
			return CommandResult.pass();
		}

		if (!(message.channel instanceof DMChannel))
			return CommandResult.pass();

		const wishes = Object.entries(this.data.participants)
			.filter(([, wish]) => wish?.granter === message.author.id);

		if (!wishes.length)
			return this.reply(message, "You have not been matched with a wisher.")
				.then(() => CommandResult.pass());

		if (wishes.length > 1)
			return this.reply(message, "You are responsible for more than one wish. Messaging between more than one wisher is not currently supported.")
				.then(() => CommandResult.pass());

		const [wisherId] = wishes[0];
		const wisher = this.guild.members.cache.get(wisherId);
		if (!wisher) {
			this.logger.warning("Could not find wish participant for messaging", wisherId);
			return CommandResult.pass();
		}

		const shouldSend = await this.yesOrNo(undefined, new MessageEmbed()
			.setTitle(`Send your wisher, **${wisher?.displayName}**, this message?`)
			.setThumbnail(wisher.user.avatarURL() ?? undefined)
			.setDescription(text.join(" ")))
			.reply(message);

		if (!shouldSend)
			return this.reply(message, "No message was sent.")
				.then(() => CommandResult.pass());

		await wisher.send(new MessageEmbed()
			.setColor("FFAA00")
			.setTitle("Your wish-granter has sent you a message:")
			.setDescription(text.join(" "))
			.addField("\u200b", "To reply, use `!wish message granter <...message>`"));

		this.logger.info("A wish-granter sent a message to their wisher.");

		return this.reply(message, "Your message was sent!")
			.then(() => CommandResult.pass());
	}

	@Command("wish message granter")
	protected async onMessageGranter (message: CommandMessage, ...text: string[]) {
		if (WishStage[this.data.stage] < WishStage.granting) {
			this.reply(message, "Messages can not yet be sent.");
			return CommandResult.pass();
		}

		if (!(message.channel instanceof DMChannel))
			return CommandResult.pass();

		const wish = this.data.participants[message.author.id];

		if (!wish)
			return this.reply(message, "You did not submit a wish.")
				.then(() => CommandResult.pass());

		const granterId = wish.granter;

		const granter = this.guild.members.cache.get(granterId!);
		if (!granter) {
			this.logger.warning("Could not find wish participant for messaging", granterId, "— Wish participant id:", message.author.id);
			return CommandResult.pass();
		}

		const shouldSend = await this.yesOrNo(undefined, new MessageEmbed()
			.setTitle(`Send your wish-granter this message?`)
			.setDescription(text.join(" ")))
			.reply(message);

		if (!shouldSend)
			return this.reply(message, "No message was sent.")
				.then(() => CommandResult.pass());

		await granter.send(new MessageEmbed()
			.setColor("0088FF")
			.setTitle(`Your wisher, **${message.member?.displayName}**, has sent you a message:`)
			.setThumbnail(message.author.avatarURL() ?? undefined)
			.setDescription(text.join(" "))
			.addField("\u200b", "To reply, use `!wish message wisher <...message>`"));

		this.logger.info("A wisher sent a message to their wish-granter.");

		return this.reply(message, "Your message was sent!")
			.then(() => CommandResult.pass());
	}

	@Command("unwish")
	protected async onUnwish (message: CommandMessage, force?: string) {
		if (this.data.stage !== "making") {
			this.reply(message, "Wishes can no longer be taken back.");
			return CommandResult.pass();
		}

		if (!(message.channel instanceof DMChannel))
			return CommandResult.pass();

		let participant = this.data.participants[message.author.id];
		if (!participant)
			return this.reply(message, "You do not currently have a wish.")
				.then(() => CommandResult.pass());

		const shouldUnwish = force === "force"
			|| await this.yesOrNo(undefined, new MessageEmbed()
				.addFields(...this.getWishParticipantFields(participant))
				.setColor("00FF00")
				.setAuthor(`${this.getName(message.author)}'s wish`, message.author.avatarURL() ?? undefined)
				.setTitle("Would you like to take back your wish?")
				.addField("\u200b", ["✅ Yes", "❌ No"].join(" \u200b · \u200b ")))
				.reply(message);

		this.reply(message, shouldUnwish ? "your wish has been taken back!" : "your wish is safe.");

		if (shouldUnwish) {
			this.logger.info(`${this.getName(message)} has taken back ${this.getPronouns(message).their} wish!`);
			delete this.data.participants[message.author.id];
		}

		return CommandResult.pass();
	}

	@Command("wish")
	protected async onParticipate (message: CommandMessage) {
		if (this.data.stage !== "making") {
			this.reply(message, "New wishes can no longer be taken. 😭");
			return CommandResult.pass();
		}

		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "Please use this command in a DM with me so as to not spam the chat. Thanks!");
			return CommandResult.pass();
		}

		let participant = this.data.participants[message.author.id];
		let isNewWish = !participant;
		participant = {
			wish: "",
			wishGranting: "",
			...participant,
		};

		if (!isNewWish) {
			const shouldEdit = await this.yesOrNo(undefined, new MessageEmbed()
				.addFields(...this.getWishParticipantFields(participant))
				.setColor("00FF00")
				.setAuthor(`${this.getName(message.author)}'s wish`, message.author.avatarURL() ?? undefined)
				.setTitle("Would you like to edit your wish?")
				.addField("\u200b", ["✅ Yes", "❌ No"].join(" \u200b · \u200b ")))
				.reply(message);

			if (!shouldEdit)
				return CommandResult.pass();
		}

		this.logger.info(`${this.getName(message)} is making/updating ${this.getPronouns(message).their} wish!`);
		const madeOrUpdated = await this.wishWizard(message, participant, isNewWish);
		this.logger.info(`${this.getName(message)} has ${madeOrUpdated ? "made/updated" : "cancelled making/updating"} ${this.getPronouns(message).their} wish!`);

		if (madeOrUpdated && this.config.participant)
			await message.member?.roles.add(this.config.participant);

		return CommandResult.pass();
	}

	private async wishWizard (message: CommandMessage, participant: IWishParticipant, isNewWish: boolean) {

		const cancelMessage = isNewWish ? "Your wish has been cancelled." : "The changes to your wish have been cancelled.";

		const wishMakingWizard = ["Make a wish!"] as [string, string?];

		////////////////////////////////////
		// wish for
		//

		let response = await this.prompter("What story would you like to see?")
			.setDescription("Give a prompt, a genre, etc. However much or little you'd like to give. **If there's anything you're uncomfortable seeing, make sure to mention it!**")
			.setColor("0088FF")
			.setIdentity(...wishMakingWizard)
			.setDefaultValue(participant.wish || undefined)
			.setMaxLength(1024)
			.reply(message);

		if (response.cancelled)
			return this.reply(message, cancelMessage)
				.then(() => false);

		response.apply(participant, "wish");

		////////////////////////////////////
		// can do
		//

		const wishGrantingWizard = ["Grant a wish!", message.author.avatarURL() ?? undefined];

		response = await this.prompter("What kind of story are you good at or comfortable with writing?")
			.setDescription("Give genres, features, etc — however much or little you'd like to define it. **If there's anything you're uncomfortable writing, make sure to mention it!**")
			.setColor("FFAA00")
			.setIdentity(...wishGrantingWizard)
			.setDefaultValue(participant.wishGranting || undefined)
			.setMaxLength(1024)
			.reply(message);

		if (response.cancelled)
			return this.reply(message, cancelMessage)
				.then(() => false);

		response.apply(participant, "wishGranting");

		////////////////////////////////////
		// pinch gifter
		//

		const pinchGranter = await this.yesOrNo(undefined, new MessageEmbed()
			.setAuthor(...wishGrantingWizard)
			.setTitle("Would you like to be a pinch wish-granter?")
			.setColor("FFFF00")
			.setDescription("Some wish granters may fail to completely grant their assigned wish — in case this occurs, pinch wish-granters will be contacted and asked to write something small to fit the prompt. Pinch wish-grants will be created after the submission deadline is past.\n\nPlease only sign up to be a pinch wish-granter if you know you'll be capable of it.")
			.addField("\u200b", ["✅ Yes", "❌ No"].join(" \u200b · \u200b ")))
			.reply(message);

		participant.canPinch = pinchGranter ?? false;

		////////////////////////////////////
		// updated
		//

		this.data.participants[message.author.id] = participant;
		this.data.markDirty();

		this.reply(message, new MessageEmbed()
			.setTitle(isNewWish ? "May your wish be granted..." : "Your wish has been updated.")
			.setColor("00FF00")
			.addFields(...this.getWishParticipantFields(participant)));

		return true;
	}

	private getWishParticipantFields (participant: IWishParticipant): IField[] {
		return [
			{ name: "Wish", value: participant.wish },
			{ name: "Can grant wishes of", value: participant.wishGranting },
			{ name: "Can grant in a pinch", value: participant.canPinch ? "Yes" : "No" },
		];
	}

	@Command("wish grant")
	protected async onWishGrant (message: CommandMessage) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "This command can only be used in a DM.");
			return CommandResult.pass();
		}

		// TODO this should function differently for pinch-grant mode
		if (this.data.stage !== "granting") {
			this.reply(message, WishStage[this.data.stage] > WishStage.granting ? "Wishes can no longer be granted. 😭" : "Wishes cannot yet be granted.");
			return CommandResult.pass();
		}

		const wishes = Object.entries(this.data.participants)
			.filter(([, wish]) => wish?.granter === message.author.id);

		type Wish = typeof wishes[number];

		let shouldDelete = false;
		const wishEntry = await new Promise<Wish | undefined>(resolve => {
			Paginator.create(wishes, ([wishParticipantId, wish], paginator, i) => {
				const member = this.guild.members.cache.get(wishParticipantId);
				return new MessageEmbed()
					.setAuthor("Wishes to grant")
					.setTitle(`#${i + 1}: ${member?.displayName}'s Wish`)
					.setThumbnail(member?.user.avatarURL() ?? undefined)
					.setColor("0088FF")
					.setDescription(wish?.wish)
					.addField("Granted?", wish?.gift ? "✅ Has gift" : "❌ No gift submitted")
					.addField("\u200b",
						["◀ Previous", "▶ Next", "❌ Cancel"].join(Strings.SPACER_DOT) + "\n" +
						["🪄 Grant wish", wish?.gift && "🗑 Remove gift"].filterNullish().join(Strings.SPACER_DOT));
			})
				.addOption("🪄", "Grant this wish!")
				.addOption(page => page.originalValue[1]?.gift && "🗑" || null, "Remove gift")
				.setShouldDeleteOnUseOption(reaction => reaction.name !== "🪄" && reaction.name !== "🗑")
				.event.subscribe("reaction", (paginator: Paginator<Wish>, reaction: Emoji | ReactionEmoji, responseMessage: Message) => {
					const wish = paginator.get().originalValue;
					if (reaction.name === "🪄") {
						paginator.cancel();
						resolve(wish);
					}

					if (reaction.name === "🗑" && wish[1]?.gift) {
						paginator.cancel();
						shouldDelete = true;
						resolve(wish);
					}
				})
				.event.subscribe("cancel", () => resolve(undefined))
				.reply(message);
		});

		const [wishParticipantId, wish] = wishEntry ?? [];
		if (!wishParticipantId || !wish)
			return CommandResult.pass();

		const wisher = this.guild.members.cache.get(wishParticipantId);
		if (wish?.gift) {
			const confirm = await this.yesOrNo(undefined, new MessageEmbed()
				.setTitle(`Are you sure you want to ${shouldDelete ? "remove" : "replace"} ${wisher?.displayName}'s gift?`)
				.setColor(shouldDelete ? "FF0000" : "FF8800")
				.addFields(
					wish.gift.message ? { name: "Message", value: wish.gift.message } : undefined,
					{ name: "File", value: wish.gift.url },
				))
				.reply(message);

			if (!confirm)
				return this.reply(message, `Okay, ${wisher?.displayName}'s ${shouldDelete ? `gift will not be removed` : "wish will be granted using the existing gift"}.`)
					.then(() => CommandResult.pass());

			if (shouldDelete) {
				delete wish.gift;
				this.data.markDirty();
				this.logger.info(`${message.member?.displayName} removed ${this.getPronouns(message).their} gift for ${this.getPronouns(message).their} wisher.`);
				return this.reply(message, `${wisher?.displayName}'s gift was removed.`)
					.then(() => CommandResult.pass());
			}
		}

		const validFileTypes = ["txt", "rtf", "docx", "odt"]

		const result = await this.prompter("Please send an attachment containing your gift to grant the wish.")
			.setDescription(`Valid file types: ${validFileTypes.map(t => `\`.${t}\``).join(", ")}. \n\nYou may include a message with the attachment, it will be sent to the wisher.`)
			.setValidator(message => {
				const [, attachment] = Stream.from(message.attachments).first() ?? [];
				return (!!attachment && validFileTypes.some(fileType => attachment?.url.endsWith(fileType))) || undefined;
			})
			.reply(message);

		if (result.cancelled || !result.message?.attachments.first())
			return this.reply(message, "No gift was submitted, no wishes were granted.")
				.then(() => CommandResult.pass());

		const attachment = result.message?.attachments.first()!;
		wish.gift = {
			url: attachment.url,
			message: result.message.content || undefined,
		};
		this.data.markDirty();

		this.logger.info(`${message.member?.displayName} uploaded/updated the gift for ${this.getPronouns(message).their} wisher!`);
		this.reply(message, new MessageEmbed()
			.setTitle(`${wisher?.displayName}'s wish will be granted!`)
			.addFields(
				wish.gift.message ? { name: "Message", value: wish.gift.message } : undefined,
				{ name: "File", value: wish.gift.url },
			));

		return CommandResult.pass();
	}

	@Command("wish match")
	protected async onWishMatch (message: CommandMessage, pinch?: string) {
		let organiser = this.guild.members.cache.get(message.author.id);
		if (!organiser?.roles.cache.has(this.config.organiser) || !(message.channel instanceof DMChannel))
			return CommandResult.pass();

		this.logger.info(`${this.getName(message)} has started wish matching!`);

		const isPinchMatch = pinch === "pinch";

		const organisers = this.guild.roles.cache.get(this.config.organiser)?.members?.values().toArray() ?? [];
		if (organisers.length < 2) {
			this.reply(message, "Not enough organisers. Requires at least 2.");
			return CommandResult.pass();
		}

		const participants = Object.entries(this.data.participants)
			.sort(([idA], [idB]) => (this.isOrganiser(idB) ? 1 : 0) - (this.isOrganiser(idA) ? 1 : 0));

		type Participant = typeof participants[number];

		if (participants.length < 4) {
			this.reply(message, "Not enough participants. Requires at least 4.");
			return CommandResult.pass();
		}

		this.data.stage = "matching";
		this.data.markDirty();

		for (const organiser of organisers)
			organiser.user.send(`Wish-matching has begun${organiser.id === message.author.id ? "" : " at the behest of a fellow organiser"}!`);

		const wishGranters = !isPinchMatch ? participants.slice()
			: participants.filter(([, participant]) => participant!.canPinch);

		// start with the organiser cursor on the organiser that started wish matching
		let cursor = organisers.findIndex(member => member.id === organiser!.id);

		const wishes = !isPinchMatch ? participants.slice()
			// if this is pinch-matching, don't re-match any wishes that have already been granted
			: participants.filter(([, participant]) => participant?.gift !== undefined);

		for (let i = 0; i < wishes.length; i++) {
			const [wishParticipantId, wish] = wishes[i];
			if (wishParticipantId === organiser.id) {
				// this wish is the organiser's wish, move it to the next position so the next organiser can match it
				const [entry] = wishes.splice(i, 1);
				wishes.splice(i + 1, 0, entry);
				i--;
				continue;
			}

			await organiser.user.send(new MessageEmbed()
				.setTitle(`Find a match capable of granting this wish${isPinchMatch ? " in a pinch" : ""}...`)
				.setDescription(wish?.wish)
				.setColor("0088FF"));

			const granters = wishGranters.filter(([id]) => id !== wishParticipantId && id !== organiser!.id);

			if (!granters.length) {
				for (const organiser of organisers)
					organiser.user.send("Whoops! Wish-matching failed — someone had no granters left for their wish. Matching will need to be restarted. Try matching a couple wishes to granters a bit differently next time?");
				return CommandResult.pass();
			}

			const granter = await new Promise<Participant | undefined>(resolve => {
				Paginator.create(granters, ([, granter], paginator, i) => new MessageEmbed()
					.setAuthor(`Candidate ${isPinchMatch ? "pinch " : ""}wish-granters`)
					.setTitle(`Candidate #${i + 1}`)
					.setColor("FFAA00")
					.setDescription(granter?.wishGranting)
					.addField("\u200b", ["◀ Previous", "▶ Next", "✅ Select this wish-granter", "❌ Cancel"].join(" \u200b · \u200b ")))
					.addOption("✅", "Match this wish-granter to the wish!")
					.setShouldDeleteOnUseOption(reaction => reaction.name !== "✅")
					.setTimeout(hours(2))
					.event.subscribe("reaction", (paginator: Paginator<Participant>, reaction: Emoji | ReactionEmoji, responseMessage: Message) => {
						const granter = paginator.get().originalValue;
						if (reaction.name === "✅") {
							paginator.cancel();
							resolve(granter);
						}
					})
					.event.subscribe("cancel", () => resolve(undefined))
					.send(organiser!.user, organiser!.user);
			});

			if (!granter) {
				for (const organiser of organisers)
					organiser.user.send("Whoops! Wish-matching was cancelled or timed out and will need to be restarted.");
				return CommandResult.pass();
			}

			// remove this wish granter from the pool
			wishGranters.splice(wishGranters.indexOf(granter), 1);

			// assign this wish granter to the wish
			wish!.granter = granter[0];
			this.data.markDirty();

			await organiser.user.send("Thanks! Please wait a moment while (one of) your fellow organiser(s) makes the next match.");

			cursor++;
			cursor = cursor % organisers.length;
			organiser = organisers[cursor];
		}

		this.data.stage = "granting";
		this.data.markDirty();

		for (const organiser of organisers)
			organiser.user.send("Wish-matching complete! It's time to grant some wishes! 🪄");

		return CommandResult.pass();
	}

	private isOrganiser (userId: string) {
		return this.guild.members.cache.get(userId)
			?.roles.cache.has(this.config.organiser);
	}
}