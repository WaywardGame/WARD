
import { GuildMember, Message, MessageEmbed, MessageReaction, TextChannel } from "discord.js";
import { Command, CommandMessage, CommandResult } from "../core/Api";
import { IInherentPluginData, Plugin } from "../core/Plugin";
import Arrays, { tuple } from "../util/Arrays";
import Strings from "../util/Strings";
import ogs = require("open-graph-scraper");

const version = 6;

interface IWatch {
	channel: string;
	postChannel: string;
	filter?: {
		text?: string[];
		gdocs?: true;
	};
	og?: {
		description?: false;
		thumbnail?: "avatar";
	}
}

export interface ICrossPostPluginConfig {
	watch: IWatch[];
}

interface ICrossPost {
	source: [string, string];
	crosspost: [string, string];
	hash: number;
	author: string;
	gdocs?: true;
}

interface IEmbedDetails {
	link?: string;
	title?: string;
	description?: string;
	thumbnail?: string;
	message?: string;
	fields?: [string, string][];
}

export interface ICrossPostPluginData extends IInherentPluginData<ICrossPostPluginConfig> {
	crossposts: Record<string, ICrossPost[]>
}

export class CrossPostPlugin extends Plugin<ICrossPostPluginConfig, ICrossPostPluginData> {

	protected initData: () => ICrossPostPluginData = () => ({ crossposts: {} });

	public getDefaultId () {
		return "crosspost";
	}

	public getDefaultConfig () {
		return { watch: [] };
	}

	public shouldExist (config: unknown) {
		return !!config;
	}

	public async onStart () {
		for (const [sourceChannelId, crosspostList] of Object.entries(this.data.crossposts)) {
			const channel = this.guild.channels.cache.get(sourceChannelId);
			if (!(channel instanceof TextChannel)) {
				this.logger.warning("Could not find channel by ID", sourceChannelId);
				continue;
			}

			for (const crosspost of crosspostList.slice(-25).reverse()) {
				const [, sourceMessageId] = crosspost.source;
				const message = await channel.messages.fetch(sourceMessageId)
					.catch(() => { });
				if (!message) {
					this.logger.warning(`Could not find source message in #${channel.name} by ID`, sourceMessageId);
					continue;
				}

				if (!await this.ensureMember(message)) {
					this.logger.warning("Message has no member", message.author.username);
					continue;
				}

				const hash = this.hash(message);
				if (crosspost.hash !== hash)
					await this.updateCrosspost(message, crosspost, hash);
			}
		}
	}

	@Command("crosspost")
	public async onCrosspost (message: CommandMessage, channelId?: string, messageId?: string) {
		if (!message.member?.permissions.has("MANAGE_MESSAGES"))
			return CommandResult.pass();

		[channelId, messageId] = resolveCrosspostID(channelId, messageId);

		const channel = channelId && this.guild.channels.cache.get(channelId);
		if (!(channel instanceof TextChannel))
			return this.reply(message, `I could not find a channel by ID "${channelId}"`)
				.then(reply => CommandResult.fail(message, reply));

		const sourceMessage = messageId && await channel.messages.fetch(messageId)
			.catch(() => { });
		if (!sourceMessage)
			return this.reply(message, `I could not find a message by ID "${messageId}" in <#${channel.id}>`)
				.then(reply => CommandResult.fail(message, reply));

		if (!await this.onMessage(sourceMessage))
			return this.reply(message, `Failed to cross-post the message from ${sourceMessage.member?.displayName}...`)
				.then(() => CommandResult.pass());

		return this.reply(message, `Cross-posted the message from ${sourceMessage.member?.displayName}!`)
			.then(() => CommandResult.pass());
	}

	public async onMessage (message: Message) {
		let crossposted = false;
		for (const watch of this.config.watch)
			if (message.channel.id === watch.channel)
				if (await this.tryCrosspost(watch, message))
					crossposted = true;

		return crossposted;
	}

	public async onReaction (reaction: MessageReaction, member: GuildMember) {
		if (reaction.emoji.name !== "❌")
			return;

		for (const crosspostList of Object.values(this.data.crossposts)) {
			for (let i = 0; i < crosspostList.length; i++) {
				const { crosspost: [crosspostChannelId, crosspostMessageId], author } = crosspostList[i];
				if (author !== member.id)
					continue; // you can't delete somebody else's crosspost, silly!!!!

				if (reaction.message.channel.id === crosspostChannelId && reaction.message.id === crosspostMessageId) {
					await reaction.message.delete()
						.catch(err => this.logger.warning("Could not delete crosspost", err.message));
					crosspostList.splice(i, 1);
					this.data.markDirty();
					return;
				}
			}
		}
	}

	public async onEdit (message: Message) {
		for (const crosspost of this.data.crossposts[message.channel.id] ?? []) {
			const { source: [, sourceMessageId] } = crosspost;
			if (sourceMessageId !== message.id)
				continue;

			const hash = this.hash(message);
			if (crosspost.hash === hash)
				continue; // hash is the same, don't bother

			await this.updateCrosspost(message, crosspost, hash);
		}
	}

	@Command("crosspost update")
	protected async onCrosspostUpdate (message: CommandMessage, findCrosspostChannelId?: string, findCrosspostMessageId?: string) {
		[findCrosspostChannelId, findCrosspostMessageId] = resolveCrosspostID(findCrosspostChannelId, findCrosspostMessageId);
		const crosspost = findCrosspostChannelId && Object.values(this.data.crossposts)
			.flat()
			.find(({ crosspost: [crosspostChannelId, crosspostMessageId] }) =>
				findCrosspostChannelId === crosspostChannelId && findCrosspostMessageId === crosspostMessageId);

		if (!crosspost)
			return this.reply(message, "could not find a crosspost message with the given crosspost channel id and message id.")
				.then(reply => CommandResult.fail(message, reply));

		const [sourceChannelId, sourceMessageId] = crosspost.source;
		const sourceMessage = await (this.guild.channels.cache.get(sourceChannelId) as TextChannel)
			?.messages.fetch(sourceMessageId)
			.catch(() => { });

		if (!sourceMessage)
			return this.reply(message, "it seems as though the crosspost source message has been deleted.")
				.then(() => CommandResult.pass());

		if (sourceMessage.author.id !== message.author.id && !message.member?.permissions.has("MANAGE_MESSAGES"))
			return CommandResult.pass();

		await this.updateCrosspost(sourceMessage, crosspost);
		return CommandResult.pass();
	}

	private async updateCrosspost (message: Message, crosspost: ICrossPost, hash = this.hash(message)) {
		const { crosspost: [crosspostChannelId, crosspostMessageId], gdocs } = crosspost;
		const channel = this.guild.channels.cache.get(crosspostChannelId) as TextChannel;
		if (!channel) {
			this.logger.warning("Could not edit crosspost, could not get channel by ID", crosspostChannelId);
			return;
		}

		const crosspostMessage = await channel.messages.fetch(crosspostMessageId)
			.catch(() => { });
		if (!crosspostMessage) {
			this.logger.warning("Could not edit crosspost, could not get message by ID", crosspostMessageId);
			return;
		}

		let openGraph: IEmbedDetails = {};
		if (gdocs)
			openGraph = await this.extractGDocs(message.content) ?? {};

		const watch = this.config.watch.find(watch => watch.channel === message.channel.id
			&& watch.postChannel === channel.id);

		if (watch?.og?.description === false)
			delete openGraph.description;

		if (watch?.og?.thumbnail === "avatar")
			openGraph.thumbnail = message.author.avatarURL() ?? undefined;

		await crosspostMessage.edit(this.createCrosspostEmbed(message, openGraph))
			.catch(err => this.logger.warning("Could not edit crosspost", err.message));

		this.logger.info("Updated crosspost:", message.content);

		crosspost.hash = hash;
		this.data.markDirty();
	}

	public async onDelete (message: Message) {
		let toRemove: ICrossPost[] = [];
		const crossposts = this.data.crossposts[message.channel.id] ?? [];
		for (const crosspost of crossposts) {
			const { crosspost: [crosspostChannelId, crosspostMessageId], source: [, sourceMessageId] } = crosspost;
			if (sourceMessageId !== message.id)
				continue;

			const channel = this.guild.channels.cache.get(crosspostChannelId) as TextChannel;
			if (!channel) {
				this.logger.warning("Could not delete crosspost, could not get channel by ID", crosspostChannelId);
				continue;
			}

			const crosspostMessage = await channel.messages.fetch(crosspostMessageId)
				.catch(() => { });
			if (!crosspostMessage) {
				this.logger.warning("Could not delete crosspost, could not get message by ID", crosspostMessageId);
				continue;
			}

			await crosspostMessage.delete()
				.catch(err => this.logger.warning("Could not delete crosspost", err.message));
			this.logger.info(`Deleted crosspost in #${channel.name}:`, message.content);
			toRemove.push(crosspost);
		}

		for (const crosspost of toRemove) {
			const index = crossposts.indexOf(crosspost);
			if (index > -1) {
				crossposts.splice(index, 1);
				this.data.markDirty();
			}
		}
	}

	private async tryCrosspost (watch: IWatch, message: Message) {
		const filters = watch.filter?.text ? Arrays.or(watch.filter.text) : [];
		for (const filter of filters)
			if (!this.matchesFilter(message, filter))
				return false;

		let openGraph: IEmbedDetails = {};
		if (watch.filter?.gdocs) {
			const extracted = await this.extractGDocs(message.content);
			if (!extracted)
				return;

			openGraph = extracted;
		}

		const postChannel = this.guild.channels.cache.get(watch.postChannel);
		if (!(postChannel instanceof TextChannel)) {
			this.logger.warning("Could not find post channel by ID", watch.postChannel);
			return false;
		}

		if (watch.og?.description === false)
			delete openGraph.description;

		if (watch.og?.thumbnail === "avatar")
			openGraph.thumbnail = message.author.avatarURL() ?? undefined;

		const crosspostMessage = await postChannel.send(this.createCrosspostEmbed(message, openGraph));

		let crossposts = this.data.crossposts[message.channel.id];
		if (!crossposts)
			crossposts = this.data.crossposts[message.channel.id] = [];

		const alreadyPosted = crossposts.some(({ crosspost: [crosspostChannelId], source: [, sourceMessageId] }) =>
			sourceMessageId === message.id && crosspostChannelId === watch.postChannel);
		if (alreadyPosted)
			return false; // already cross-posted

		this.logger.info(`Crossposted message to #${postChannel.name}:`, message.content);
		crossposts.push({
			source: [message.channel.id, message.id],
			crosspost: [watch.postChannel, crosspostMessage.id],
			hash: this.hash(message),
			author: message.author.id,
			gdocs: watch.filter?.gdocs,
		});
		this.data.markDirty();
		return true;
	}

	private readonly regexCache = new Map<string, RegExp>();

	private matchesFilter (message: Message, filter: string) {
		let realFilter: string | RegExp = filter;
		if (filter[0] === "/" && filter[filter.length - 1] === "/")
			realFilter = this.regexCache.getOrDefault(filter, () => new RegExp(filter.slice(1, -1)), true);

		if (typeof realFilter === "string")
			return message.content.includes(realFilter);

		return realFilter.test(message.content);
	}

	private createCrosspostEmbed (message: Message, openGraph: IEmbedDetails) {
		const avatarURL = message.author.avatarURL() ?? undefined;
		return new MessageEmbed()
			.setAuthor(message.member!.displayName, avatarURL === openGraph.thumbnail ? undefined : avatarURL)
			.setColor(message.member!.displayHexColor)
			.setURL(openGraph.link)
			.setTitle(openGraph.title)
			.setThumbnail(openGraph.thumbnail)
			.setDescription(`${(`${openGraph.message ?? message.content} `).replace(/(\[.*?\]\([^\[\]()]*?\))\s*$/, "$1\n")}[[Message]](${message.url})`)
			.addFields(...!openGraph.description ? [] : [
				{ name: "Document Preview", value: this.reformatOpenGraphDescription(openGraph.description) },
			])
			.setFooter("Was this not supposed to appear here? React with ❌");
	}

	private hash (message: Message) {
		return Strings.hash(`${version}%${message.member?.displayName}%${message.content}`);
	}

	private reformatOpenGraphDescription (description?: string) {
		if (!description)
			return "";

		return `> ||${description.replace(/\r?\n/g, "||\n> ||")}||`;
	}

	private async extractGDocs (text: string, preserveLinks = false): Promise<IEmbedDetails | undefined> {
		const regex = /\bhttps:\/\/docs\.google\.com\/document\/d\/(.*?)\/edit(\?(&?(usp=(sharing|drivesdk)|pli=1))*)?(#(heading=h\.\w+)?)?/;
		const match = text.match(regex);
		if (!match)
			return;

		const gdocsLink = match[0];

		const embed = await this.extractOpenGraph(gdocsLink);
		if (!embed)
			return;

		const before = text.slice(0, match.index);
		let after = text.slice(match.index! + gdocsLink.length);
		let link = "";

		if (embed.title && (regex.test(after) || preserveLinks)) {
			link = `[${embed.title}](${gdocsLink})`;
			after = (await this.extractGDocs(after, true))?.message ?? "";
		}

		embed.message = `${before}${link}${after}`;

		return embed;
	}

	private async extractOpenGraph (link: string): Promise<IEmbedDetails> {
		let title: string | undefined;
		let description: string | undefined;
		let thumbnail: string | undefined;

		const ogData = await ogs({ url: link });
		if (ogData.error) {
			this.logger.warning("Could not get Open Graph data for link", link, ogData.result);
		} else {
			title = ogData.result.ogTitle;
			description = ogData.result.ogDescription;
			thumbnail = ogData.result.ogImage?.url;
		}

		return { link, title, description, thumbnail };
	}

}

function resolveCrosspostID (channelId?: string, messageId?: string): [string, string] | undefined[] {
	if (channelId === undefined)
		return [];

	if (messageId !== undefined)
		return tuple(channelId, messageId);

	[channelId, messageId] = channelId.split("-");
	if (!channelId || !messageId)
		return [];

	return tuple(channelId, messageId)
}
