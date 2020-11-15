import { MessageEmbed, TextChannel } from "discord.js";
import { ImportApi } from "../core/Api";
import { Plugin } from "../core/Plugin";
import { minutes } from "../util/Time";
import { IStream, IUser, Twitch } from "../util/Twitch";

interface IEmbedDescription {
	author?: string;
	title?: string;
	description?: string;
}

export interface IStreamDetector {
	game?: string;
	streamer?: string;
	channel: string;
	message?: string;
	embed?: true | IEmbedDescription;
}

interface IStreamDetectorMessage extends IStreamDetector {
	message: string;
}

interface IStreamDetectorEmbed extends IStreamDetector {
	embed: true | IEmbedDescription;
}

type StreamDetector = IStreamDetectorMessage | IStreamDetectorEmbed;

export interface ITwitchStreamPluginConfig {
	streamDetectors: StreamDetector[];
	warningChannel?: string;
}

export interface ITwitchStreamPluginData {
	trackedStreams: Record<string, number>,
	failing: boolean,
}

export class TwitchStreamPlugin extends Plugin<ITwitchStreamPluginConfig, ITwitchStreamPluginData> {
	public updateInterval = minutes(5);

	@ImportApi("twitch")
	private twitch: Twitch = undefined!;
	private warningChannel?: TextChannel;

	private get trackedStreams () { return this.data.trackedStreams; }

	protected initData = () => ({ trackedStreams: {}, failing: false });

	public getDefaultId () {
		return "twitchStream";
	}

	public async onUpdate () {
		this.warningChannel = !this.config.warningChannel ? undefined
			: this.guild.channels.cache.get(this.config.warningChannel) as TextChannel;

		// this.log("Updating streams...");
		const updateTime = Date.now();
		try {
			await this.updateStreams(updateTime);
			this.data.failing = false;
			await this.cleanupTrackedStreams(updateTime);
		} catch (err) {
			this.logger.error("Cannot update Twitch streams", err);
			if (err.error.message === "Invalid OAuth token" && !this.data.failing) {
				this.data.failing = true;
				this.warningChannel?.send(new MessageEmbed()
					.setColor("FF0000")
					.setTitle("Unable to update streams 😭")
					.setDescription("Twitch OAuth token has been reset (for some reason)"));
			}
		}
		// this.log("Update complete.");
	}

	private async cleanupTrackedStreams (updateTime: number) {
		for (const trackedStreamId of Object.keys(this.trackedStreams))
			if (updateTime != this.trackedStreams[trackedStreamId])
				delete this.trackedStreams[trackedStreamId];
	}

	private async updateStreams (updateTime: number) {
		const updates: (readonly [string, number])[] = [];

		for (const streamDetector of this.config.streamDetectors) {
			if (streamDetector.game) {
				const streams = await this.twitch.getStreams(streamDetector.game);

				for (const stream of streams)
					updates.push(await this.updateStream(streamDetector, stream, updateTime));

			} else {
				const stream = await this.twitch.getStream(streamDetector.streamer);
				if (stream)
					updates.push(await this.updateStream(streamDetector, stream, updateTime));
			}
		}

		for (const [username, time] of updates)
			this.trackedStreams[username] = time;

		if (updates.length)
			this.data.markDirty();
	}

	private async updateStream (streamDetector: StreamDetector, stream: IStream, time: number) {
		if (!this.trackedStreams[stream.user_name]) {
			this.logger.info(`Channel ${stream.user_name} went live: ${stream.title}`);

			const user = await this.twitch.getUser(stream.user_id);
			const game = await this.twitch.getGame(stream.game_id);
			const channel = this.guild.channels.cache.get(streamDetector.channel) as TextChannel;

			const embed = typeof streamDetector.embed === "object" ? streamDetector.embed : {};
			channel.send(streamDetector.message ? interpolateStreamInfo(streamDetector.message, stream, user) : "",
				streamDetector.embed ? new MessageEmbed()
					.setAuthor(user?.display_name || stream.user_name, game ? user?.profile_image_url : undefined)
					.setURL(user && `https://twitch.tv/${user.login}`)
					.setTitle(interpolateStreamInfo(embed.title || "{title}", stream, user))
					.setDescription(game ? `Streaming **${game?.name}** on Twitch.tv` : undefined)
					.setThumbnail(game ? game.box_art_url.replace("{width}", "285").replace("{height}", "380") : user?.profile_image_url) : undefined);
		}

		return [stream.user_name, time] as const;
	}
}

function interpolateStreamInfo (str: string | undefined, stream: IStream, user?: IUser) {
	return str
		?.replace("{name}", escape(user?.display_name || stream.user_name))
		.replace("{title}", escape(stream.title));
}

function escape (text: string) {
	return text.replace(/_/g, "\\_").replace(/\*/g, "\\*");
}
