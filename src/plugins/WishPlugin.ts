import { DMChannel, Emoji, Message, MessageEmbed, ReactionEmoji } from "discord.js";
import { Command, CommandMessage, CommandResult, IField } from "../core/Api";
import { Paginator } from "../core/Paginatable";
import { Plugin } from "../core/Plugin";

export interface IWishParticipant {
	wish: string;
	wishGranting: string;
	canPinch?: boolean;
	granter?: string;
	gift?: string;
}

export interface IWishConfig {
	organiser: string;
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

		const cancelMessage = isNewWish ? "Your wish has been cancelled." : "The changes to your wish have been cancelled.";

		const wishMakingWizard = ["Make a wish!"] as [string, string?];

		this.logger.info(`${this.getName(message)} is making/updating ${this.getPronouns(message).their} wish!`);

		////////////////////////////////////
		// wish for
		//

		let response = await this.prompter("What story would you like to see?")
			.setDescription("Give a prompt, a genre, etc. However much or little you'd like to give. **If there's anything you're uncomfortable seeing, make sure to mention it!**")
			.setColor("0088FF")
			.setIdentity(...wishMakingWizard)
			.setDefaultValue(participant.wish || undefined)
			.reply(message);

		if (response.cancelled)
			return this.reply(message, cancelMessage)
				.then(() => CommandResult.pass());

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
			.reply(message);

		if (response.cancelled)
			return this.reply(message, cancelMessage)
				.then(() => CommandResult.pass());

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

		this.logger.info(`${this.getName(message)} has made/updated ${this.getPronouns(message).their} wish!`);

		return CommandResult.pass();
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

		const wish = await new Promise<Wish | undefined>(resolve => {
			Paginator.create(wishes, ([wishParticipantId, granter], paginator, i) => new MessageEmbed()
				.setAuthor("Wishes to grant")
				.setTitle(`Wish #${i + 1}`)
				.setColor("0088FF")
				.setDescription(this.data.participants[wishParticipantId]?.wish)
				.addField("\u200b", ["◀ Previous", "▶ Next", "🪄 Grant this wish", "❌ Cancel"].join(" \u200b · \u200b ")))
				.addOption("🪄", "Grant this wish!")
				.setShouldDeleteOnUseOption(reaction => reaction.name !== "🪄")
				.event.subscribe("reaction", (paginator: Paginator<Wish>, reaction: Emoji | ReactionEmoji, responseMessage: Message) => {
					const wish = paginator.get().originalValue;
					if (reaction.name === "🪄") {
						paginator.cancel();
						resolve(wish);
					}
				})
				.event.subscribe("cancel", () => resolve(undefined))
				.reply(message);
		});

		if (!wish)
			return CommandResult.pass();

		this.reply(message, "This functionality has not been implemented yet. Stay tuned!");
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