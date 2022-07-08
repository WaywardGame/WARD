import fetch from "node-fetch";
import { Api } from "../core/Api";
import { sleep } from "./Async";
import Logger from "./Log";
import { minutes } from "./Time";


const endpoint = "https://api.twitch.tv/helix/";

export enum StreamType {
	Live = "live",
	Vodcast = "vodcast",
	Playlist = "playlist",
}

export interface IStream {
	user_id: string;
	user_name: string;
	title: string;
	game_id: string;
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

export interface IGame {
	id: string;
	name: string;
	box_art_url: string;
}

export interface IPaginatedResult {
	data: any[];
	pagination: { cursor: string };
}

export interface ITwitchConfig {
	client: string;
	secret: string;
	redirectUri: string;
}

const defaultSleepTime = 10000;
let sleepTime = defaultSleepTime;
let isRequesting = false;
let lastRequestTime = 0;

export class Twitch extends Api<ITwitchConfig> {
	public getDefaultId () {
		return "twitch";
	}

	public getAuthURL () {
		return `https://id.twitch.tv/oauth2/authorize?client_id=${this.config.client}&redirect_uri=${this.config.redirectUri}&response_type=code&scope=user:read:email`;
	}

	public async getToken (authCode: string) {
		return fetch("https://id.twitch.tv/oauth2/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: Object.entries({
				client_id: this.config.client,
				client_secret: this.config.secret,
				code: authCode,
				grant_type: "authorization_code",
			})
				.map(entry => entry.join("="))
				.join("&"),
		})
			.then(response => response.json());
	}

	public async getStreams (game: string): Promise<IStream[]> {
		return this.paginationTwitchRequest(`streams?game_id=${game}&first=100`);
	}

	public async getStream (streamer?: string): Promise<IStream | undefined> {
		return streamer && this.twitchRequest(`streams?user_login=${streamer}`).then(result => result.data[0]);
	}

	public async getUser (id: string): Promise<IUser | undefined> {
		return this.twitchRequest(`users?id=${id}`).then(result => result.data[0]);
	}

	public async getGame (id: string): Promise<IGame | undefined> {
		return this.twitchRequest(`games?id=${id}`).then(result => result.data[0]);
	}

	private async paginationTwitchRequest (rq: string): Promise<any[]> {
		const results = [];
		let rqResult: IPaginatedResult | undefined;
		do {
			rqResult = await this.twitchRequest(rqResult ? `${rq}&after=${rqResult.pagination.cursor}` : rq);
			if (!rqResult)
				break;

			results.push(...rqResult.data || []);
		} while (rqResult.data && rqResult.data.length >= 100);

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
				const r = fetch(`${rq.startsWith(endpoint) ? "" : endpoint}${rq}`, {
					headers: {
						"Client-ID": this.config.client,
						"Authorization": `Bearer ${this.config.token}`
					},
				});

				const response = await r;
				result = await response.json();
				if (result.error)
					throw result;

				const ratelimit = response.headers.get("Ratelimit-Limit");
				sleepTime = Math.max(defaultSleepTime, minutes(1) / (+ratelimit! ?? 1));

			} catch (err) {
				lastRequestTime = Date.now();

				if (err?.message === "Invalid OAuth token")
					throw err;

				if (++tries > 100)
					throw err;

				Logger.error(err);
			}

		} while (!result);

		isRequesting = false;
		lastRequestTime = Date.now();

		return result;
	}
}
