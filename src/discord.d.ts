/// <reference types="discord.js" />

declare module "discord.js" {
	// tslint:disable-next-line interface-name
	interface Channel {
		send (text: string): void;
	}
}
