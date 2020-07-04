import { TextChannel } from "discord.js";
import { ImportApi } from "../core/Api";
import { Plugin } from "../core/Plugin";
import { sleep } from "../util/Async";
import { minutes, seconds } from "../util/Time";
import { IStream, Twitch } from "../util/Twitch";

export interface IStreamDetector {
	game?: string;
	streamer?: string;
	channel: string;
	message: string;
}

export interface ITwitchStreamPluginConfig {
	streamDetectors: IStreamDetector[];
}

export interface ITwitchStreamPluginData {
	trackedStreams: Record<string, number>,
}

export class TwitchStreamPlugin extends Plugin<ITwitchStreamPluginConfig, ITwitchStreamPluginData> {
	public updateInterval = minutes(5);

	@ImportApi("twitch")
	private twitch: Twitch = undefined!;

	private trackedStreams: Record<string, number>;

	public getDefaultId () {
		return "twitchStream";
	}

	public async onStart () {
		this.trackedStreams = this.getData("trackedStreams", {});
	}

	public async onUpdate () {
		// this.log("Updating streams...");
		const updateTime = Date.now();
		await this.updateStreams(updateTime);
		await this.cleanupTrackedStreams(updateTime);
		// this.log("Update complete.");
	}

	private async cleanupTrackedStreams (updateTime: number) {
		for (const trackedStreamId of Object.keys(this.trackedStreams)) {
			if (updateTime != this.trackedStreams[trackedStreamId]) {
				delete this.trackedStreams[trackedStreamId];
			}
		}
	}

	private async updateStreams (updateTime: number) {
		for (const streamDetector of this.config.streamDetectors) {
			if (streamDetector.game) {
				const streams = await this.twitch.getStreams(streamDetector.game);

				for (const stream of streams) {
					await this.updateStream(streamDetector, stream, updateTime);
				}

			} else {
				const stream = await this.twitch.getStream(streamDetector.streamer);

				if (stream) {
					await this.updateStream(streamDetector, stream, updateTime);
				}
			}
		}
	}

	private async updateStream (streamDetector: IStreamDetector, stream: IStream, time: number) {
		if (!this.trackedStreams[stream.user_name]) {
			this.logger.info(`Channel ${stream.user_name} went live: ${stream.title}`);

			const user = await this.twitch.getUser(stream.user_id);

			(this.guild.channels.find(channel => channel.id === streamDetector.channel) as TextChannel)
				.send(streamDetector.message
					.replace("{name}", escape(stream.user_name))
					.replace("{title}", escape(stream.title))
					.replace("{link}", user ? `https://twitch.tv/${user.login}` : "(No link found. Twitch API pls)"));
		}

		sleep(seconds(1)).then(() => {
			this.trackedStreams[stream.user_name] = time;
		});
	}
}

function escape (text: string) {
	return text.replace(/_/g, "\\_").replace(/\*/g, "\\*");
}
