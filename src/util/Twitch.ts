import * as request from "request-promise-native";

import { Api } from "../core/Api";
import { sleep } from "./Async";
import { Logger } from "./Log";
import { minutes } from "./Time";

const endpoint = "https://api.twitch.tv/kraken/";

export enum StreamType {
	Live = "live",
	Vodcast = "vodcast",
	Playlist = "playlist",
}

export interface IStream {
	_id: number;
	game: string;
	community_ids: string[];
	type: StreamType;
	title: string;
	viewer_count: number;
	started_at: string;
	language: string;
	thumbnail_url: string;
	channel: {
		name: string;
		display_name: string;
		_id: number;
	}
}

export interface IUser {
	id: string;
	login: string;
	display_name: string;
	type: string;
	broadcaster_type: "" | "affiliate" | "partner";
	description: string;
	profile_image_url: string;
	offline_image_url: string;
	view_count: number;
}

export interface IPaginatedResult {
	streams: any[];
	_total: number;
	_links: {
		next: string;
	}
}

export interface ITwitchConfig {
	client: string;
}

let sleepTime = 10000;
let isRequesting = false;
let lastRequestTime = 0;

export class Twitch extends Api<ITwitchConfig> {
	public getDefaultId () {
		return "twitch";
	}

	public async getStreams (game: string): Promise<IStream[]> {
		return this.paginationTwitchRequest(`streams?game=${game}&limit=100`);
	}

	public async getStream (streamer: string): Promise<IStream> {
		return this.twitchRequest(`streams/${streamer}`).then(result => result.stream);
	}

	private async paginationTwitchRequest (rq: string): Promise<any[]> {
		const results = [];
		let rqResult: IPaginatedResult;
		do {
			rqResult = await this.twitchRequest(rqResult ? rqResult._links.next : rq);
			if (!rqResult) {
				break;
			}

			results.push(...rqResult.streams || []);
		} while (rqResult.streams && rqResult.streams.length >= 100);

		return results;
	}

	private async twitchRequest (rq: string) {
		while (isRequesting) {
			await sleep(100);
		}

		isRequesting = true;

		let result: any;
		let tries = 0;
		do {
			if (Date.now() - lastRequestTime < sleepTime) {
				await sleep(sleepTime - (Date.now() - lastRequestTime));
			}

			try {
				const r = request(`${rq.startsWith(endpoint) ? "" : endpoint}${rq}`, {
					headers: {
						"Client-ID": this.config.client,
					},
					json: true,
				});

				result = await r;

				const ratelimit = r.response.headers["ratelimit-limit"];
				sleepTime = minutes(1) / +ratelimit;
			} catch (err) {
				tries++;
				if (tries > 100) {
					throw err;
				}

				Logger.log(err);
			}

		} while (!result);

		isRequesting = false;
		lastRequestTime = Date.now();

		return result;
	}
}
