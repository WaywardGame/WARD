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

export interface IAuthError {
	status: number;
	message: string;
}

export interface IAuthTokenResponse {
	status: undefined;
	message: undefined;
	access_token: string;
	expires_in: number;
	refresh_token: string;
	scope: string[];
	token_type: "bearer";
}

export interface ITokens {
	access: string;
	refresh: string;
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

	public async getToken (authCode: string): Promise<IAuthError | IAuthTokenResponse> {
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
				redirect_uri: this.config.redirectUri,
			})
				.map(entry => entry.join("="))
				.join("&"),
		})
			.then(response => response.json());
	}

	public async getStreams (tokens: ITokens, game: string): Promise<IStream[]> {
		return this.paginationTwitchRequest(tokens, `streams?game_id=${game}&first=100`);
	}

	public async getStream (tokens: ITokens, streamer?: string): Promise<IStream | undefined> {
		return streamer && this.twitchRequest(tokens, `streams?user_login=${streamer}`).then(result => result.data?.[0]);
	}

	public async getUser (tokens: ITokens, id: string): Promise<IUser | undefined> {
		return this.twitchRequest(tokens, `users?id=${id}`).then(result => result.data?.[0]);
	}

	public async getGame (tokens: ITokens, id: string): Promise<IGame | undefined> {
		return this.twitchRequest(tokens, `games?id=${id}`).then(result => result.data?.[0]);
	}

	private async paginationTwitchRequest (tokens: ITokens, rq: string): Promise<any[]> {
		const results = [];
		let rqResult: IPaginatedResult | undefined;
		do {
			rqResult = await this.twitchRequest(tokens, rqResult ? `${rq}&after=${rqResult.pagination.cursor}` : rq);
			if (!rqResult)
				break;

			results.push(...rqResult.data || []);
		} while (rqResult.data && rqResult.data.length >= 100);

		return results;
	}

	private async twitchRequest (tokens: ITokens, rq: string) {
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
						"Authorization": `Bearer ${tokens.access}`
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
					await this.refreshToken(tokens);

				if (++tries > 100)
					throw err;

				Logger.error(err);
			}

		} while (!result);

		isRequesting = false;
		lastRequestTime = Date.now();

		return result;
	}

	private async refreshToken (tokens: ITokens) {
		const newTokens = await fetch("https://id.twitch.tv/oauth2/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: Object.entries({
				client_id: this.config.client,
				client_secret: this.config.secret,
				refresh_token: tokens.refresh,
				grant_type: "refresh_token",
			})
				.map(entry => entry.join("="))
				.join("&"),
		})
			.then(response => response.json()) as IAuthTokenResponse;

		if (!newTokens.refresh_token)
			throw Object.assign(new Error("Invalid OAuth token"), { detail: "Unable to refresh token" });

		tokens.access = newTokens.access_token;
		tokens.refresh = newTokens.refresh_token;
	}
}
