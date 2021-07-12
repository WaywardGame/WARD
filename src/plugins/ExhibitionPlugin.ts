import { DMChannel, MessageEmbed } from "discord.js";
import { Command, CommandMessage, CommandResult } from "../core/Api";
import { IInherentPluginData, Plugin } from "../core/Plugin";
import Arrays from "../util/Arrays";
import { COLOR_BAD, COLOR_GOOD, COLOR_WARNING } from "../util/Colors";
import Scrape from "../util/Scrape";
import Strings from "../util/Strings";
import { getTime, hours, minutes } from "../util/Time";

interface IExhibitionPluginConfig {
	exhibitions: Record<string, IExhibitionConfig>;
}

interface IExhibitionConfig {
	channel: string;
	fields: IExhibitionFieldConfig[];
	duration: string;
	pin: boolean;
}

interface IExhibitionFieldConfig {
	name: string;
	prompt: string;
	detail: string;
}

interface IExhibitionData extends IInherentPluginData {
	exhibitions: Record<string, IExhibition>;
}

interface IExhibition {
	lastShown: number;
	submissions: [null | ISubmission, ...ISubmission[]];
}

interface ISubmission {
	author: string;
	title: string;
	links: string;
	fields: string[];
	messageId?: string;
}

export default class ExhibitionPlugin extends Plugin<IExhibitionPluginConfig, IExhibitionData> {

	public updateInterval = hours(1);

	public getDefaultId () {
		return "exhibitions";
	}

	public getDefaultConfig () {
		return { exhibitions: {} };
	}

	public shouldExist (config: unknown) {
		return !!config;
	}

	protected initData: () => IExhibitionData = () => ({ exhibitions: {} });

	public async onUpdate () {
		for (const [exhibitionName, exhibitionConfig] of Object.entries(this.config.exhibitions)) {
			const exhibition = this.data.exhibitions[exhibitionName];
			if (!exhibition)
				continue;

			if (Date.now() - exhibition.lastShown - minutes(30) < getTime(exhibitionConfig.duration))
				continue; // not enough time passed

			const channel = this.getChannel(exhibitionConfig.channel);
			if (!channel)
				continue;

			const oldSubmissionMessageId = exhibition.submissions[0]?.messageId;
			if (oldSubmissionMessageId) {
				const oldMessage = await channel.messages.fetch(oldSubmissionMessageId).catch(() => { });
				await oldMessage?.unpin();
				this.logger.info(`Ended previous "${exhibitionName}" exhibition: ${exhibition.submissions[0]!.title}`);
			}

			this.data.markDirty();
			exhibition.submissions.shift();
			if (exhibition.submissions[0]) {
				exhibition.lastShown = Date.now();
				const message = await channel.send(await this.getSubmissionEmbed(exhibitionConfig, exhibition.submissions[0]));
				exhibition.submissions[0].messageId = message.id;
				if (exhibitionConfig.pin)
					await message.pin();
				this.logger.info(`Started new "${exhibitionName}" exhibition: ${exhibition.submissions[0].title}.`);
			}

			if (exhibition.submissions.length === 0) {
				exhibition.submissions.push(null);
				this.logger.info(`There are no more submissions to exhibit for the "${exhibitionName}" exhibition. Downtime is starting.`);
			}
		}
	}

	// @Command("exhibition next")
	// public async onExhibitionNext (message: CommandMessage, exhibitionName: string) {
	// 	const exhibition = this.data.exhibitions[exhibitionName];
	// 	exhibition.lastShown = 0;
	// 	await this.onUpdate();
	// 	return CommandResult.pass();
	// }

	@Command("exhibition shuffle")
	public async onShuffle (message: CommandMessage, exhibitionName: string) {
		if (!message.member?.permissions.has("MANAGE_MESSAGES"))
			return CommandResult.pass();

		const exhibitionConfig = this.config.exhibitions[exhibitionName];
		if (!exhibitionConfig)
			return this.reply(message, new MessageEmbed()
				.setColor(COLOR_BAD)
				.setTitle(exhibitionName ? "Please provide an exhibition name." : `Unknown exhibition "${exhibitionName}"`)
				.addField("Valid Exhibitions", Object.keys(this.config.exhibitions).join(", ")))
				.then(reply => CommandResult.fail(message, reply));

		const exhibition = this.data.exhibitions[exhibitionName];
		if ((exhibition?.submissions.length ?? 0) <= 1)
			return CommandResult.pass();

		this.data.markDirty();
		const first = exhibition.submissions.shift()!;
		Arrays.shuffle(exhibition.submissions.filterNullish());
		exhibition.submissions.unshift(first);
		this.logger.info(`${this.getName(message)} shuffled the submissions of the "${exhibitionName}" exhibition.`);

		return this.reply(message, new MessageEmbed()
			.setColor(COLOR_GOOD)
			.setTitle(`Shuffled ${exhibition.submissions.length - 1} submissions.`))
			.then(() => CommandResult.pass());
	}

	@Command("exhibition")
	public async onExhibitionCommand (message: CommandMessage, exhibitionName: string) {
		if (!(message.channel instanceof DMChannel))
			return this.reply(message, new MessageEmbed()
				.setColor(COLOR_BAD)
				.setTitle("This command must be used in DMs."))
				.then(() => CommandResult.pass());

		const exhibitionConfig = this.config.exhibitions[exhibitionName];
		if (!exhibitionConfig)
			return this.reply(message, new MessageEmbed()
				.setColor(COLOR_BAD)
				.setTitle(exhibitionName ? "Please provide an exhibition name." : `Unknown exhibition "${exhibitionName}"`)
				.addField("Valid Exhibitions", Object.keys(this.config.exhibitions).join(", ")))
				.then(reply => CommandResult.fail(message, reply));

		this.logger.info(`${this.getName(message)} entered the exhibition wizard.`);
		const result = await this.exhibitionWizard(message, exhibitionName, exhibitionConfig);
		this.logger.info(`${this.getName(message)} exited the exhibition wizard.`);
		return result;
	}


	public async exhibitionWizard (message: CommandMessage, exhibitionName: string, exhibitionConfig: IExhibitionConfig) {
		this.data.markDirty();
		const exhibition = this.data.exhibitions[exhibitionName]
			?? (this.data.exhibitions[exhibitionName] = {
				lastShown: 0,
				submissions: [null],
			});

		let submission = exhibition.submissions.find(submission => submission?.author === message.author.id);
		const onExhibition = exhibition.submissions[0] === submission;
		while (submission) {
			const edit = await this.promptReaction(await this.reply(message, (await this.getSubmissionEmbed(exhibitionConfig, submission))
				.addField(Strings.BLANK, ["✏ Edit", "🗑 Remove"].join(Strings.SPACER_DOT))))
				.addOption("✏")
				.addOption("🗑")
				.reply(message);

			delete message.previous;
			if (!edit.response || edit.response?.name === "❌")
				return CommandResult.pass();

			if (edit.response?.name === "🗑") {
				const remove = await this.yesOrNo(undefined, new MessageEmbed()
					.setColor(COLOR_WARNING)
					.setTitle("Are you sure you want to remove your submission?")
					.setDescription(!onExhibition ? undefined
						: "Your submission is currently on exhibition, removing it will not delete it from the history, it will only replace it with the next exhibition in the queue. If you want it removed entirely, you'll need to contact the mods."))
					.reply(message);

				delete message.previous;
				if (remove) {
					this.data.markDirty();
					exhibition.submissions.splice(exhibition.submissions.indexOf(submission), 1);
					if (onExhibition) {
						exhibition.lastShown = 0;
						this.onUpdate()
							.then(() => this.data.saveOpportunity());
					}

					return this.reply(message, new MessageEmbed()
						.setColor(COLOR_BAD)
						.setTitle("Submission removed."))
						.then(() => CommandResult.pass());
				}
			}

			if (edit.response?.name === "✏")
				break;
		}


		////////////////////////////////////
		// Title
		//
		let result = await this.prompter("What is the title of your submission?")
			.setDefaultValue(submission?.title)
			.setMaxLength(256)
			.reply(message);

		delete message.previous;
		if (result.cancelled)
			return this.reply(message, new MessageEmbed()
				.setColor(COLOR_BAD)
				.setTitle(submission ? "Edits discarded." : "Submission cancelled."))
				.then(() => CommandResult.pass());

		const title = result.value!;

		////////////////////////////////////
		// Link
		//
		let scraped: Scrape.IEmbedDetails | undefined;
		result = await this.prompter("Please provide the link(s) to your submission.")
			.setDefaultValue(submission?.links)
			.setValidator(async message => {
				scraped = await Scrape.extractGDocs(message.content, true);
				const links = [...scraped?.link ? [scraped.link] : [], ...scraped?.otherLinks ?? []];
				if (!links.length)
					return "Requires at least one link.";

				return true;
			})
			.reply(message);

		delete message.previous;
		if (result.cancelled)
			return this.reply(message, new MessageEmbed()
				.setColor(COLOR_BAD)
				.setTitle(submission ? "Edits discarded." : "Submission cancelled."))
				.then(() => CommandResult.pass());


		////////////////////////////////////
		// Fields
		//

		const fields = [];
		for (let i = 0; i < exhibitionConfig.fields.length; i++) {
			const field = exhibitionConfig.fields[i];
			result = await this.prompter(field.prompt)
				.setDescription(field.detail || undefined)
				.setDefaultValue(submission?.fields[i])
				.setMaxLength(1024)
				.reply(message);

			delete message.previous;
			if (result.cancelled)
				return this.reply(message, new MessageEmbed()
					.setColor(COLOR_BAD)
					.setTitle(submission ? "Edits discarded." : "Submission cancelled."))
					.then(() => CommandResult.pass());

			fields.push(result.value!);
		}


		const oldSubmission = submission;
		submission = {
			author: message.author.id,
			title,
			links: scraped?.message! ?? submission?.links,
			fields,
			messageId: submission?.messageId,
		};

		const submit = await this.yesOrNo(undefined, (await this.getSubmissionEmbed(exhibitionConfig, submission))
			.setColor(COLOR_WARNING))
			.reply(message);

		if (!submit)
			return this.reply(message, new MessageEmbed()
				.setColor(COLOR_BAD)
				.setTitle(submission ? "Edits discarded." : "Submission cancelled."))
				.then(() => CommandResult.pass());


		////////////////////////////////////
		// Submit
		//

		this.data.markDirty();
		if (oldSubmission)
			exhibition.submissions[exhibition.submissions.indexOf(oldSubmission)] = submission;
		else
			exhibition.submissions.push(submission);

		if (submission?.messageId && onExhibition) {
			const channel = this.getChannel(exhibitionConfig.channel);
			const oldMessage = await channel?.messages.fetch(submission.messageId).catch(() => { });
			await oldMessage?.edit(await this.getSubmissionEmbed(exhibitionConfig, submission));
		}

		this.onUpdate()
			.then(() => this.data.saveOpportunity());

		return this.reply(message, new MessageEmbed()
			.setColor(COLOR_GOOD)
			.setTitle(oldSubmission ? "Edited!" : "Submitted!"))
			.then(() => CommandResult.pass());
	}

	private async getSubmissionEmbed (exhibition: IExhibitionConfig, submission: ISubmission) {
		const author = await this.guild.members.fetch(submission.author);
		return new MessageEmbed()
			.setTitle(submission.title)
			.setAuthor(author.displayName)
			.setThumbnail(author.user.avatarURL() ?? undefined)
			.addField("Links", submission.links)
			.addFields(...submission.fields.map((field, i) => ({ name: exhibition.fields[i].name, value: field })));
	}
}
