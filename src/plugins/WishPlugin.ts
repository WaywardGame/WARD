import Stream from "@wayward/goodstream";
import { Collection, DMChannel, Emoji, Message, MessageAttachment, MessageEmbed, ReactionEmoji } from "discord.js";
import { Command, CommandMessage, CommandResult, IField, ImportPlugin } from "../core/Api";
import { Paginator } from "../core/Paginatable";
import { IInherentPluginData, Plugin } from "../core/Plugin";
import { COLOR_BAD, COLOR_GOOD, COLOR_WARNING } from "../util/Colors";
import Strings from "../util/Strings";
import { getTime, hours, minutes, renderTime } from "../util/Time";
import PronounsPlugin from "./PronounsPlugin";

export interface IWishParticipant {
	wish: string;
	wishGranting: string;
	canPinch?: boolean;
	scribble?: boolean;
	itch?: boolean;
	itchCut?: boolean;
	granter?: string;
	gift?: {
		message?: string;
		url: string;
	},
}

export interface IWishConfig {
	organiser: string;
	participant?: string;
}

export enum WishStage {
	making,
	matching,
	granting,
	// pinchGranting,
	ended,
}

export interface IWishData extends IInherentPluginData<IWishConfig> {
	distributeTime?: number;
	stage: keyof typeof WishStage;
	participants: Record<string, IWishParticipant | undefined>;
	messages?: number;
}

export default class WishPlugin extends Plugin<IWishConfig, IWishData> {

	@ImportPlugin("pronouns")
	private pronouns: PronounsPlugin = undefined!;

	public readonly updateInterval = minutes(1);

	public getDefaultId () {
		return "wish";
	}

	public shouldExist (config: unknown) {
		return !!config;
	}

	public initData: () => IWishData = () => ({ participants: {}, stage: "making" });

	public async onUpdate () {
		if (this.data.distributeTime && Date.now() > this.data.distributeTime) {
			this.logger.info("Beginning gift distribution");
			for (const participantId of Object.keys(this.data.participants))
				await this.deliverGift(participantId);

			this.logger.info("Distributed gifts");
			this.data.remove("distributeTime");
			this.data.stage = "ended";
		}
	}

	private async deliverGift (participantId: string) {
		const participant = this.data.participants[participantId]!;
		const member = this.guild.members.cache.get(participantId);
		if (!participant?.gift || !member)
			return false;

		await member.send({
			embed: new MessageEmbed()
				.setTitle("Your wish has been granted!")
				.setColor("AA00FF")
				.addFields(!participant.gift.message ? undefined : { name: "A message from your wish-granter:", value: participant.gift.message })
				.addField(Strings.BLANK, "Remember that you can message your wish-granter without knowing their identity using `!wish message granter <...message>`"),
			files: [new MessageAttachment(participant.gift.url)]
		});
		this.logger.info(`Sent gift to ${member.displayName}`);

		return true;
	}

	@Command("wish reset")
	protected async onWishReset (message: CommandMessage) {
		let organiser = this.guild.members.cache.get(message.author.id);
		if (!organiser?.roles.cache.has(this.config.organiser) || !(message.channel instanceof DMChannel))
			return CommandResult.pass();

		const confirmation = await this.yesOrNo(undefined, new MessageEmbed()
			.setTitle("Are you sure you want to clear all wish data?")
			.setColor(COLOR_WARNING))
			.reply(message);

		if (!confirmation)
			return message.reply(new MessageEmbed()
				.setTitle("Wish data was not cleared.")
				.setColor(COLOR_GOOD))
				.then(() => CommandResult.pass());

		this.data.reset();

		const role = this.config.participant && await this.findRole(this.config.participant);
		if (role)
			for (const member of role.members.values())
				await member.roles.remove(role);

		return message.reply(new MessageEmbed()
			.setTitle("All wish data cleared.")
			.setColor(COLOR_BAD))
			.then(() => CommandResult.pass());
	}

	@Command("wish csv")
	protected async onCommandWishCSV (message: CommandMessage) {
		let organiser = this.guild.members.cache.get(message.author.id);
		if (!organiser?.roles.cache.has(this.config.organiser) || !(message.channel instanceof DMChannel))
			return CommandResult.pass();

		const csv = `Wisher,Prompt,Wish-granter,Gift,Itch,Scribble`
			.newline(Object.entries(this.data.participants)
				.map(([participantId, participant]) => participant && [
					this.guild.members.cache.get(participantId)?.displayName ?? "Unknown",
					participant.wish,
					!participant.granter ? "No granter" : this.guild.members.cache.get(participant.granter!)?.displayName ?? "Unknown",
					participant.gift?.url ?? "No Gift",
					!participant.itch ? "" : participant.itchCut ? "Yes" : "Yes, no cut",
					participant.scribble ? "Yes" : ""]
					.map(Strings.csvalue)
					.join(","))
				.filterNullish()
				.join("\n"));

		message.reply(new MessageAttachment(Buffer.from(csv, "utf8"), `wishes.csv`));
		return CommandResult.pass();
	}

	@Command("wish message wisher")
	protected async onMessageWisher (message: CommandMessage, ...text: string[]) {
		if (!(message.channel instanceof DMChannel))
			return CommandResult.pass();

		if (WishStage[this.data.stage] < WishStage.granting) {
			this.reply(message, "Messages can not yet be sent.");
			return CommandResult.pass();
		}

		const wishes = Object.entries(this.data.participants)
			.filter(([, wish]) => wish?.granter === message.author.id);

		if (!wishes.length)
			return this.reply(message, "You have not been matched with a wisher.")
				.then(() => CommandResult.pass());

		let [wisherId] = wishes[0];
		if (wishes.length > 1) {
			const userQuery = text.shift();
			const wishers = wishes.map(([id]) => [id, this.guild.members.cache.get(id)!] as const)
				.filter(([, member]) => member);
			const result = await this.findMember(userQuery!, new Collection(wishers));
			if (result instanceof Collection)
				return this.reply(message, `You are responsible for more than one wish. Your query '${userQuery}' matched multiple of your wishers.`)
					.then(() => CommandResult.pass());

			if (!result)
				return this.reply(message, `You are responsible for more than one wish. Your query '${userQuery}' matched none of your wishers.`)
					.then(() => CommandResult.pass());

			wisherId = result.id;
		}

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

		this.data.messages ??= 0;
		this.data.messages++;
		this.logger.info("A wish-granter sent a message to their wisher.");

		return this.reply(message, "Your message was sent!")
			.then(() => CommandResult.pass());
	}

	@Command("wish message granter")
	protected async onMessageGranter (message: CommandMessage, ...text: string[]) {
		if (!(message.channel instanceof DMChannel))
			return CommandResult.pass();

		if (WishStage[this.data.stage] < WishStage.granting) {
			this.reply(message, "Messages can not yet be sent.");
			return CommandResult.pass();
		}

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

		this.data.messages ??= 0;
		this.data.messages++;
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
				.setColor(COLOR_WARNING)
				.setAuthor(`${this.getName(message.author)}'s wish`, message.author.avatarURL() ?? undefined)
				.setTitle("Would you like to take back your wish?")
				.addField("\u200b", ["✅ Yes", "❌ No"].join(" \u200b · \u200b ")))
				.reply(message);

		if (shouldUnwish) {
			this.logger.info(`${this.getName(message)} has taken back ${this.pronouns.referTo(message).their} wish!`);
			delete this.data.participants[message.author.id];
		}

		this.reply(message, new MessageEmbed()
			.setTitle(shouldUnwish ? "Your wish has been taken back!" : "Your wish is safe.")
			.setColor(shouldUnwish ? COLOR_BAD : COLOR_GOOD));

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
			const prompt = await this.reply(message, new MessageEmbed()
				.addFields(...this.getWishParticipantFields(participant))
				.setColor("00FF00")
				.setAuthor(`${this.getName(message.author)}'s wish`, message.author.avatarURL() ?? undefined)
				.setTitle("Would you like to edit your wish?")
				.addField(Strings.BLANK, ["✅ Yes", "❌ No", "🗑 Delete"].join(Strings.SPACER_DOT)));

			const { response } = await this.promptReaction(prompt)
				.addOption("✅", "Yes")
				.addOption("❌", "No")
				.addOption("🗑", "Delete")
				.reply(message);

			if (!response || response.name === "❌")
				return CommandResult.pass();

			if (response.name === "🗑")
				return this.onUnwish(message);
		}

		this.logger.info(`${this.getName(message)} is making/updating ${this.pronouns.referTo(message).their} wish!`);
		const madeOrUpdated = await this.wishWizard(message, participant, isNewWish);
		this.logger.info(`${this.getName(message)} has ${madeOrUpdated ? "made/updated" : "cancelled making/updating"} ${this.pronouns.referTo(message).their} wish!`);

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
			.setDescription("Give a prompt, a genre, etc. However much or little you'd like to give. **If there's anything you're uncomfortable seeing, make sure to mention it!**\n\nNote: Unless the author that grants your wish says otherwise, they will retain all rights to their material, even if it was based on your wish. Contact an event organiser if you have questions.")
			.setColor("0088FF")
			.setIdentity(...wishMakingWizard)
			.setDefaultValue(participant.wish || undefined)
			.setMaxLength(1024)
			.setTimeout(minutes(30))
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
			.setDescription("Give genres, features, etc — however much or little you'd like to define it. **If there's anything you're uncomfortable writing, make sure to mention it!**\n\nNote: You retain all rights to any material you write. By sending material to me, you give me the right to store it and distribute it as per the event timeline. Contact an event organiser if you have questions.")
			.setColor("FFAA00")
			.setIdentity(...wishGrantingWizard)
			.setDefaultValue(participant.wishGranting || undefined)
			.setMaxLength(1024)
			.setTimeout(minutes(30))
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
			.setDescription("Some wish granters may not completely grant their assigned wish — in case this occurs, pinch wish-granters will be contacted and asked to write something small to fit the prompt. Pinch wish-grants will be created after the submission deadline is past.\n\nPlease only sign up to be a pinch wish-granter if you know you'll be capable of it.")
			.addField("\u200b", ["✅ Yes", "❌ No"].join(" \u200b · \u200b ")))
			.reply(message);

		participant.canPinch = pinchGranter ?? false;

		////////////////////////////////////
		// itch
		//

		const itch = await this.yesOrNo(undefined, new MessageEmbed()
			.setAuthor(...wishGrantingWizard)
			.setTitle("Would you like the story you write to be part of the itch.io bundle?")
			.setColor("FFFF00")
			.setDescription("You will be responsible for uploading the story to itch yourself, but saying yes here allows us to keep track of who wants to be in the bundle and make sure that everyone that wants to get in gets in.\n\nNote: Don't worry about this too much if you don't know now — you can change this any time before the bundle is created.")
			.addField("\u200b", ["✅ Yes", "❌ No"].join(" \u200b · \u200b ")))
			.reply(message);

		participant.itch = itch ?? false;

		if (participant.itch) {
			////////////////////////////////////
			// cut
			//

			const cut = await this.yesOrNo(undefined, new MessageEmbed()
				.setAuthor(...wishGrantingWizard)
				.setTitle("Do you want to receive a cut of the income from the itch.io bundle?")
				.setColor("FFFF00")
				.setDescription("You deserve compensation for your work, but in case your financial situation or local laws make it not possible for you to receive monetary compensation, you can opt-out here. Your cut will be distributed between the rest of the authors in the bundle.")
				.addField("\u200b", ["✅ Yes", "❌ No"].join(" \u200b · \u200b ")))
				.reply(message);

			participant.itchCut = cut ?? true;
		}

		////////////////////////////////////
		// scribble
		//

		const scribble = await this.yesOrNo(undefined, new MessageEmbed()
			.setAuthor(...wishGrantingWizard)
			.setTitle("Would you like the story you write to be part of the Scribble Hub anthology?")
			.setColor("FFFF00")
			.setDescription("Again, this allows us to keep track of who wants to be in the anthology and make sure that everyone that wants to get in gets in. Note that even if your writing is published in the anthology, you can still upload your material yourself, separately.\n\nNote: Don't worry about this too much if you don't know now — you can change this any time before the bundle is created.")
			.addField("\u200b", ["✅ Yes", "❌ No"].join(" \u200b · \u200b ")))
			.reply(message);

		participant.scribble = scribble ?? false;


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
			{ name: "Participating in the itch bundle", value: participant.itch ? `Yes${participant.itchCut ? "" : ", but no cut"}` : "No" },
			{ name: "Participating in the Scribble Hub anthology", value: participant.scribble ? "Yes" : "No" },
		];
	}

	@Command("wish unassign")
	protected async onWishUnassign (message: CommandMessage, userid: string) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "This command can only be used in a DM.");
			return CommandResult.pass();
		}

		const wishesToUnassign = Object.values(this.data.participants)
			.filter(wish => wish?.granter === userid) as IWishParticipant[];

		const granter = this.guild.members.cache.get(userid);
		const granterName = granter?.displayName ?? "Unknown User";

		if (!wishesToUnassign.length)
			return this.reply(message, `${granterName} is not assigned any wishes.`)
				.then(() => CommandResult.pass());

		const pronouns = this.pronouns.referTo(granter);
		const confirm = await this.yesOrNo(undefined, new MessageEmbed()
			.setColor("FF0000")
			.setTitle(`Unassign **${granterName}** from the **${wishesToUnassign.length}** wish(es) ${pronouns.they} ${pronouns.are} assigned to?`))
			.reply(message);

		if (!confirm)
			return this.reply(message, `${granterName} was not unassigned from any wishes.`)
				.then(() => CommandResult.pass());

		for (const wish of wishesToUnassign)
			delete wish.granter;

		this.data.markDirty();

		const result = `${granterName} was unassigned from all ${wishesToUnassign.length} of ${pronouns.their} wishes.`;
		this.logger.info(result);

		return this.reply(message, result)
			.then(() => CommandResult.pass());
	}

	@Command("wish grant")
	protected async onWishGrant (message: CommandMessage) {
		if (!(message.channel instanceof DMChannel)) {
			this.reply(message, "This command can only be used in a DM.");
			return CommandResult.pass();
		}

		if (WishStage[this.data.stage] < WishStage.granting) {
			this.reply(message, "Wishes cannot yet be granted.");
			return CommandResult.pass();
		}

		// if (WishStage[this.data.stage] > WishStage.pinchGranting) {
		// 	this.reply(message, "Wishes can no longer be granted. 😭");
		// 	return CommandResult.pass();
		// }

		const canDeliverGift = WishStage[this.data.stage] >= WishStage.ended;

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
						["🪄 Grant wish", wish?.gift && "🗑 Remove gift", wish?.gift && canDeliverGift && "💌 Deliver gift"].filterNullish().join(Strings.SPACER_DOT));
			})
				.addOption("🪄", "Grant this wish!")
				.addOption(page => page.originalValue[1]?.gift && "🗑" || null, "Remove gift")
				.addOption(page => page.originalValue[1]?.gift && canDeliverGift && "💌" || null, "Deliver gift")
				.setShouldDeleteOnUseOption(reaction => reaction.name !== "🪄" && reaction.name !== "🗑" && reaction.name !== "💌")
				.event.subscribe("reaction", (paginator: Paginator<Wish>, reaction: Emoji | ReactionEmoji, responseMessage: Message) => {
					const wish = paginator.get().originalValue;
					if (reaction.name === "🪄") {
						paginator.cancel();
						resolve(wish);
					}

					if (reaction.name === "💌" && canDeliverGift) {
						paginator.cancel();
						resolve(undefined);
						this.deliverGift(wish[0])
							.then(() => {
								this.reply(message, "Gift delivered!");
							});
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
				this.logger.info(`${message.member?.displayName} removed ${this.pronouns.referTo(message).their} gift for ${this.pronouns.referTo(message).their} wisher.`);
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

		this.logger.info(`${message.member?.displayName} uploaded/updated the gift for ${this.pronouns.referTo(message).their} wisher!`);
		const willBeGrantedMessage = await this.reply(message, new MessageEmbed()
			.setTitle(`${wisher?.displayName}'s wish will be granted!`)
			.addFields(
				wish.gift.message ? { name: "Message", value: wish.gift.message } : undefined,
				{ name: "File", value: wish.gift.url },
			)
			.addFields(...canDeliverGift ? [{ name: Strings.BLANK, value: "💌 Deliver to your wisher" }] : []));

		const { response } = await this.promptReaction(willBeGrantedMessage)
			.addOptions(...canDeliverGift ? [["💌"] as const] : [])
			.reply(message);

		if (response?.name === "💌" && canDeliverGift)
			this.deliverGift(wishParticipantId)
				.then(() => {
					this.reply(message, "Gift delivered!");
				});

		return CommandResult.pass();
	}

	@Command("wish status")
	protected async onWishStatus (message: CommandMessage) {
		let organiser = this.guild.members.cache.get(message.author.id);
		if (!organiser?.roles.cache.has(this.config.organiser) || !(message.channel instanceof DMChannel))
			return CommandResult.pass();

		const pinchGranters = Object.values(this.data.participants).filter(wisher => wisher?.canPinch).length;
		const itchSignups = Object.values(this.data.participants).filter(wisher => wisher?.itch).length;
		const itchCuts = Object.values(this.data.participants).filter(wisher => wisher?.itch && wisher.itchCut).length;
		const scribbleSignups = Object.values(this.data.participants).filter(wisher => wisher?.scribble).length;

		let info = `**${Object.keys(this.data.participants).length}** wishes.\n**${pinchGranters}** pinch-granters.\n**${itchSignups}** itch.io bundle signups.${itchCuts === itchSignups ? "" : ` (**${itchCuts}** cuts)`}\n**${scribbleSignups}** Scribble anthology signups.\n**${this.data.messages ?? 0}** messages sent.`;

		if (this.data.stage === "making") {
			const wishers = Stream.entries(this.data.participants)
				.map<IField & { sortPos: number }>(([id, participant]) => ({
					sortPos: this.guild.members.cache.get(id)?.displayName ? 1 : 0,
					name: this.guild.members.cache.get(id)?.displayName ?? "⚠ Unknown wisher",
					value: `Pinch: ${participant?.canPinch ? "Yes" : "No"}`,
					inline: true,
				}))
				.sorted((a, b) => a.sortPos - b.sortPos)
				.toArray();

			return Paginator.create(wishers)
				.setPageHeader("Wishes are being made!")
				.setPageDescription(info)
				.setColor("0088FF")
				.reply(message)
				.then(() => CommandResult.pass());
		}

		if (this.data.stage === "granting") { //|| this.data.stage === "pinchGranting") {
			const wishGranters = Stream.values(this.data.participants)
				.partition(wish => wish?.granter, wish => !!wish?.gift)
				.partitions()
				.map<IField & { sortPos: number }>(([granter, wishes]) => ({
					sortPos: (granter && this.guild.members.cache.get(granter)?.displayName) ? 1 : 0,
					name: (granter && this.guild.members.cache.get(granter)?.displayName) ?? `⚠ No or unknown granter — reassign with \`${this.commandPrefix}wish match unassigned\``,
					value: `${!granter ? "" : `Pinch: ${this.data.participants[granter]?.canPinch ? "Yes" : "No"}`}\n`
						+ `${wishes
							.partition(g => g)
							.toArrayMap()
							.entries()
							.map(([hasGift, arr]) => `${hasGift ? "✅ Gift submitted" : "❌ No gift submitted"} (${arr.length})`)
							.sorted()
							.toString(Strings.SPACER_DOT)}`,
				}))
				.sorted((a, b) => a.sortPos - b.sortPos)
				.toArray();

			const countCompleted = wishGranters.stream()
				.partition(({ value }) => value.includes("❌"))
				.get(false)
				.count();

			return Paginator.create(wishGranters)
				.setPageHeader(`Wishes are being ${/*this.data.stage === "pinchGranting" ? "pinch-" :*/ ""}granted!`)
				.setPageDescription(`${info}\n\n**${countCompleted}** out of **${wishGranters.length}** wish-granters have submitted gifts.\nHere's a list of the wish-granters and the status on their submissions:`)
				.setColor("FFAA00")
				.reply(message)
				.then(() => CommandResult.pass());
		}

		return this.reply(message, new MessageEmbed()
			.setTitle(`${Strings.sentence(this.data.stage)} stage`)
			.setDescription(info))
			.then(() => CommandResult.pass());
	}

	@Command("wish match")
	protected async onWishMatch (message: CommandMessage, mode?: string) {
		let organiser = this.guild.members.cache.get(message.author.id);
		if (!organiser?.roles.cache.has(this.config.organiser) || !(message.channel instanceof DMChannel))
			return CommandResult.pass();

		this.logger.info(`${this.getName(message)} has started wish matching!`);

		const isUnassignedMatch = mode === "unassigned";
		const isPinchMatch = mode === "pinch" || isUnassignedMatch;

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

		if (this.data.stage === "making")
			this.data.stage = "matching";

		const wishGranters = !isPinchMatch ? participants.slice()
			: participants.filter(([, participant]) => participant!.canPinch);

		// start with the organiser cursor on the organiser that started wish matching
		let cursor = organisers.findIndex(member => member.id === organiser!.id);

		const wishes = isUnassignedMatch ? participants.filter(([, participant]) => participant?.granter === undefined)
			// if this is pinch-matching, don't re-match any wishes that have already been granted
			: isPinchMatch ? participants.filter(([, participant]) => participant?.gift !== undefined)
				: participants.slice();

		if (!wishes.length)
			return this.reply(message, "There are no wishes to match!")
				.then(() => CommandResult.pass());

		for (const organiser of organisers)
			organiser.user.send(`Wish-matching has begun${organiser.id === message.author.id ? "" : " at the behest of a fellow organiser"}!`);

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

			const granters = wishGranters.filter(([id]) =>
				id !== wishParticipantId
				&& (isPinchMatch || id !== organiser!.id));

			if (!granters.length) {
				for (const organiser of organisers)
					organiser.user.send("Whoops! Wish-matching failed — someone had no granters left for their wish. Matching will need to be restarted. Try matching a couple wishes to granters a bit differently next time?");
				return CommandResult.pass();
			}

			let granter: Participant | undefined;
			while (true) {
				granter = await new Promise<Participant | undefined>(resolve => {
					Paginator.create(granters, ([granterId, granter], paginator, i) => {
						const granterMember = this.guild.members.cache.get(granterId);
						return new MessageEmbed()
							.setAuthor(`Candidate ${isPinchMatch ? "pinch " : ""}wish-granters`)
							.setTitle(`Candidate #${i + 1}${isPinchMatch ? `: ${granterMember?.displayName ?? "Unknown granter"}` : ""}`)
							.setThumbnail(isPinchMatch && granterMember?.user.avatarURL() || undefined)
							.setColor("FFAA00")
							.setDescription(granter?.wishGranting)
							.addField("Assigned wishes", Object.values(this.data.participants)
								.filter(participant => participant?.granter === granterId)
								.length)
							.addField("\u200b", ["◀ Previous", "▶ Next", "✅ Select this wish-granter", "❌ Cancel"].join(" \u200b · \u200b "))
					})
						.addOption("✅", "Match this wish-granter to the wish!")
						.setShouldDeleteOnUseOption(reaction => reaction.name !== "✅")
						.setTimeout(hours(5))
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

				if (!isPinchMatch)
					break;

				const [granterId] = granter;
				const granterMember = this.guild.members.cache.get(granterId);
				if (!granterMember) {
					for (const organiser of organisers)
						organiser.user.send("Whoops! I could not find a selected granter's profile. Wish matching will need to be restarted.");
					return CommandResult.pass();
				}

				await organiser.user.send("Sending a request to the chosen wish-granter...");

				const willPinch = await this.yesOrNo(undefined, new MessageEmbed()
					.setTitle("Would you be willing to pinch-grant this wish?")
					.setDescription("You are signed up as a pinch-wish-granter and have been selected as a candidate to pinch-grant the following wish:")
					.addField("Wish", wish?.wish!)
					.setColor("0088FF"))
					.setTimeout(hours(5))
					.send(granterMember);

				if (!willPinch) {
					await organiser.user.send("That granter denied to pinch-grant that wish, or let the request time out. Try another?");
					continue;
				}

				await granterMember.send(`Thanks! Remember, you can use \`${this.commandPrefix}wish grant\` to see all of your assigned wishes and their wishers.`);
				await organiser.user.send("That granter accepted the wish! May it be granted!");

				break;
			}

			if (!isPinchMatch)
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

		if (WishStage[this.data.stage] < WishStage.granting)
			this.data.stage = "granting";

		this.data.markDirty();

		for (const organiser of organisers)
			organiser.user.send("Wish-matching complete! It's time to grant some wishes! 🪄");

		return CommandResult.pass();
	}

	@Command("wish distribute cancel")
	protected async onCommandWishDistributeCancel (message: CommandMessage) {
		let organiser = this.guild.members.cache.get(message.author.id);
		if (!organiser?.roles.cache.has(this.config.organiser) || !(message.channel instanceof DMChannel))
			return CommandResult.pass();

		this.data.remove("distributeTime");

		this.logger.info("Cancelled gift distribution");
		this.reply(message, new MessageEmbed()
			.setTitle("Wish gift distribution has been cancelled.")
			.setColor("FF0000"));
		return CommandResult.pass();
	}

	@Command("wish distribute after")
	protected async onCommandWishDistribute (message: CommandMessage, timeString: string) {
		let organiser = this.guild.members.cache.get(message.author.id);
		if (!organiser?.roles.cache.has(this.config.organiser) || !(message.channel instanceof DMChannel))
			return CommandResult.pass();

		if (WishStage[this.data.stage] < WishStage.granting)
			return this.reply(message, "It's too early to distribute wishes, it's not even the granting stage yet!")
				.then(() => CommandResult.pass());

		const time = getTime(timeString) ?? 0;
		this.data.distributeTime = Date.now() + time;

		this.logger.info(`Set gift distribution to occur after ${renderTime(time)}`);
		this.reply(message, new MessageEmbed()
			.setTitle(`Wish gift distribution is set to occur after ${renderTime(time)}`)
			.setColor("00FF00"));
		return CommandResult.pass();
	}

	@Command(["wish pinch", "wish unpinch"])
	protected async onCommandWishPinch (message: CommandMessage) {
		if (!(message.channel instanceof DMChannel))
			return this.reply(message, "This command can only be used in a DM.")
				.then(() => CommandResult.pass());

		const participant = this.data.participants[message.author.id];
		if (!participant)
			return this.reply(message, "You aren't a participant, silly!")
				.then(() => CommandResult.pass());

		const confirm = await this.yesOrNo(undefined, new MessageEmbed()
			.setTitle(`You are currently set ${participant.canPinch ? "as a pinch-wish-granter. Opt-out?" : "to not be a pinch-wish-granter. Opt-in?"}`)
			.setColor(participant.canPinch ? "FF0000" : "00FF00"))
			.reply(message);

		if (!confirm)
			return this.reply(message, `Okay! You are still **opted-${participant.canPinch ? "in to" : "out of"}** pinch-wish-granting.`)
				.then(() => CommandResult.pass());

		if (participant.canPinch)
			delete participant.canPinch;
		else
			participant.canPinch = true;

		this.data.markDirty();

		return this.reply(message, `Okay! You are now **opted-${participant.canPinch ? "in to" : "out of"}** pinch-wish-granting.`)
			.then(() => CommandResult.pass());
	}

	private isOrganiser (userId: string) {
		return this.guild.members.cache.get(userId)
			?.roles.cache.has(this.config.organiser);
	}
}