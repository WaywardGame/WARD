
import { GuildMember, Message, MessageEmbed, MessageReaction, TextChannel } from "discord.js";
import { Command, CommandMessage, CommandResult } from "../core/Api";
import { Plugin } from "../core/Plugin";
import Arrays from "../util/Arrays";
import Strings from "../util/Strings";
import ogs = require("open-graph-scraper");

interface IWatch {
	channel: string;
	postChannel: string;
	filter?: {
		text?: string[];
		gdocs?: true;
	};
}

export interface ICrossPostPluginConfig {
	watch: IWatch[];
}

interface ICrossPost {
	source: string;
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
}

export interface ICrossPostPluginData {
	crossposts: Record<string, ICrossPost[]>
}

export class CrossPostPlugin extends Plugin<ICrossPostPluginConfig, ICrossPostPluginData> {

	protected initData = () => ({ crossposts: {} });

	public getDefaultId () {
		return "crosspost";
	}

	public getDefaultConfig () {
		return { watch: [] };
	}

	public shouldExist (config: unknown) {
		return !!config;
	}

	@Command("crosspost")
	public async onCrosspost (message: CommandMessage, channelId: string, messageId: string) {
		if (!message.member?.permissions.has("MANAGE_MESSAGES"))
			return CommandResult.pass();

		const channel = this.guild.channels.cache.get(channelId);
		if (!(channel instanceof TextChannel))
			return this.reply(message, `I could not find a channel by ID "${channelId}"`)
				.then(reply => CommandResult.fail(message, reply));

		const sourceMessage = await channel.messages.fetch(messageId);
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
			const { crosspost: [crosspostChannelId, crosspostMessageId], source, gdocs } = crosspost;
			if (source !== message.id)
				continue;

			const hash = this.hash(message);
			if (crosspost.hash === hash)
				continue; // hash is the same, don't bother

			const channel = this.guild.channels.cache.get(crosspostChannelId) as TextChannel;
			if (!channel) {
				this.logger.warning("Could not edit crosspost, could not get channel by ID", crosspostChannelId);
				continue;
			}

			const crosspostMessage = await channel.messages.fetch(crosspostMessageId);
			if (!crosspostMessage) {
				this.logger.warning("Could not edit crosspost, could not get message by ID", crosspostMessageId);
				continue;
			}

			let openGraph: IEmbedDetails = {};
			if (gdocs)
				openGraph = await this.extractGDocs(message) ?? {};

			await crosspostMessage.edit(this.createCrosspostEmbed(message, openGraph))
				.catch(err => this.logger.warning("Could not edit crosspost", err.message));
			crosspost.hash = hash;
			this.data.markDirty();
		}
	}

	public async onDelete (message: Message) {
		let toRemove: ICrossPost[] = [];
		const crossposts = this.data.crossposts[message.channel.id] ?? [];
		for (const crosspost of crossposts) {
			const { crosspost: [crosspostChannelId, crosspostMessageId], source } = crosspost;
			if (source !== message.id)
				continue;

			const channel = this.guild.channels.cache.get(crosspostChannelId) as TextChannel;
			if (!channel) {
				this.logger.warning("Could not delete crosspost, could not get channel by ID", crosspostChannelId);
				continue;
			}

			const crosspostMessage = await channel.messages.fetch(crosspostMessageId);
			if (!crosspostMessage) {
				this.logger.warning("Could not delete crosspost, could not get message by ID", crosspostMessageId);
				continue;
			}

			await crosspostMessage.delete()
				.catch(err => this.logger.warning("Could not delete crosspost", err.message));
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
			const extracted = await this.extractGDocs(message);
			if (!extracted)
				return;

			openGraph = extracted;
		}

		const postChannel = this.guild.channels.cache.get(watch.postChannel);
		if (!(postChannel instanceof TextChannel)) {
			this.logger.warning("Could not find post channel by ID", watch.postChannel);
			return false;
		}

		const crosspostMessage = await postChannel.send(this.createCrosspostEmbed(message, openGraph));

		let crossposts = this.data.crossposts[message.channel.id];
		if (!crossposts)
			crossposts = this.data.crossposts[message.channel.id] = [];

		if (crossposts.some(crosspost => crosspost.source === message.id && crosspost.crosspost[0] === watch.postChannel))
			return false; // already cross-posted

		crossposts.push({
			source: message.id,
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
		return new MessageEmbed()
			.setAuthor(message.member!.displayName, message.author.avatarURL() ?? undefined)
			.setColor(message.member!.displayHexColor)
			.setURL(openGraph.link)
			.setTitle(openGraph.title)
			.setThumbnail(openGraph.thumbnail)
			.setDescription(`${openGraph.message ?? message.content} [[Message]](${message.url})`)
			.addFields(...!openGraph.description ? [] : [
				{ name: "Document Preview", value: this.reformatOpenGraphDescription(openGraph.description) },
			])
			.setFooter("Was this not supposed to appear here? React with ❌");
	}

	private hash (message: Message) {
		return Strings.hash(`${message.member!.displayName}%${message.content}`);
	}

	private reformatOpenGraphDescription (description?: string) {
		if (!description)
			return "";

		return `> ||${description.replace(/\r?\n/g, "||\n> ||")}||`;
	}

	private async extractGDocs (message: Message): Promise<IEmbedDetails | undefined> {
		const match = message.content.match(/\bhttps:\/\/docs\.google\.com\/document\/d\/(.*?)\/edit(\?(usp=sharing)?|#)?/);
		if (!match)
			return;

		const gdocsLink = match[0];

		const embed = await this.extractOpenGraph(gdocsLink);
		if (!embed)
			return;

		embed.message = message.content.slice(0, match.index) + message.content.slice(match.index! + gdocsLink.length);

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
