declare module 'discord.js' {
	interface Channel {
		send (text: string): void;
	}
}