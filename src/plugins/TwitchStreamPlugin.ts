import { ImportApi } from "../core/Api";
import { Plugin } from "../core/Plugin";
import { minutes } from "../util/Time";
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

export enum TwitchStreamPluginData {
	TrackedStreams,
}

export class TwitchStreamPlugin extends Plugin<ITwitchStreamPluginConfig, TwitchStreamPluginData> {
	public updateInterval = minutes(5);

	@ImportApi("twitch")
	private twitch: Twitch = undefined;

	private trackedStreams: { [key: string]: number };

	public getDefaultId () {
		return "twitchStream";
	}

	public async onStart () {
		this.trackedStreams = await this.data(TwitchStreamPluginData.TrackedStreams, {});
	}

	public async onUpdate () {
		this.log("Updating streams...");
		const updateTime = Date.now();
		await this.updateStreams(updateTime);
		await this.cleanupTrackedStreams(updateTime);
		this.log("Update complete.");
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
		if (!this.trackedStreams[stream.id]) {
			const user = await this.twitch.getUser("id", stream.user_id);
			this.log(`Channel ${user.display_name} went live: ${stream.title}`);
			this.guild.channels.find("id", streamDetector.channel)
				.send(streamDetector.message
					.replace("{name}", user.display_name)
					.replace("{title}", stream.title)
					.replace(/_/g, "\\_")
					.replace(/\*/g, "\\*")
					.replace("{link}", `https://twitch.tv/${user.login}`));
		}

		this.trackedStreams[stream.id] = time;
	}
}
