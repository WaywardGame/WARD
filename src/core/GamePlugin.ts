import Stream from "@wayward/goodstream";
import { Message, MessageEmbed } from "discord.js";
import { tuple } from "../util/Arrays";
import Strings from "../util/Strings";
import { Command, CommandMessage, CommandResult, IField, ImportPlugins } from "./Api";
import { Paginator } from "./Paginatable";
import { Plugin } from "./Plugin";

export interface IGameBase<PLAYER_DATA = {}> {
	joinable: boolean;
	players: Record<string, PLAYER_DATA>;
	aliveCheck: number;
}

export interface IGame<PLAYER_DATA> extends IGameBase<PLAYER_DATA> {
	status: string;
}

type Player<GAME extends IGame<any>> = GAME extends IGame<infer PLAYER_DATA> ? PLAYER_DATA : never;

export default abstract class GamePlugin<GAME extends IGame<any>, CONFIG extends {} = any, DATA = {}> extends Plugin<CONFIG, DATA> {

	private lobbies = new Map<string, GAME>();

	@ImportPlugins(plugin => plugin instanceof GamePlugin)
	private gamePlugins: GamePlugin<IGame<any>>[] = [];

	protected getPlayers (game: GAME) {
		return Object.keys(game.players)
			.map(playerId => this.guild.members.cache.get(playerId))
			.filterNullish();
	}

	protected abstract getGameName (): string;
	protected abstract getGameDescription (): string;
	protected abstract getGameRules (): MessageEmbed;

	protected abstract createGame (message: CommandMessage, game: IGameBase): PromiseOr<GAME | undefined>;
	protected abstract createPlayer (message: CommandMessage): PromiseOr<Player<GAME> | undefined>;
	protected abstract startGame (message: CommandMessage, game: GAME, lobbyId: string): any;

	protected onJoined?(id: string, player: Player<GAME>, game: GAME): any;
	protected onLeft?(id: string, player: Player<GAME>, game: GAME): any;
	protected onCreatedGame?(game: GAME): any;

	private gameIds = Strings.unique();

	@Command("games")
	protected onCommandGames (message: CommandMessage) {
		Stream.of()
			.add<IField | undefined>(!this.gamePlugins.some(plugin => plugin.lobbies.size) ? undefined
				: { name: Strings.BLANK, value: "**__Current Lobbies__**" })
			.filterNullish()
			.merge(this.gamePlugins.stream()
				.flatMap(plugin => plugin.lobbies.entries()
					.map<IField>(([lobbyId, game]) => ({
						name: `${plugin.getGameName()} (Lobby ${lobbyId})`,
						value: `Status: **${game.status}** (${game.joinable ? `join with \`${this.commandPrefix}game join ${plugin.getId()} ${lobbyId}\`` : "Not joinable"})`
							.newline(`Players: **${Object.keys(game.players).length}**`)
					}))))
			.add<IField>({ name: Strings.BLANK, value: "**__All Games__**" })
			.merge(this.gamePlugins.stream()
				.map<IField>(plugin => ({
					name: plugin.getGameName(),
					value: plugin.getGameDescription()
						.newline()
						.newline(`Games running: **${plugin.lobbies.size}**`)
						.newline(`Create a new lobby with \`${this.commandPrefix}game create ${plugin.getId()}\``)
				})))
			.collect(Paginator.create)
			.reply(message);

		return CommandResult.pass();
	}

	@Command("game create")
	protected async onCommandGameCreate (message: CommandMessage, type: string) {
		const gamePlugin = this.gamePlugins.find(plugin => plugin.getId() === type);
		if (!gamePlugin)
			return this.reply(message, `Could not find the game \`${type}\`. Did you misspell it by any chance?`
				.newline(`All games: ${this.gamePlugins.map(plugin => `\`${plugin.getId()}\``).join(", ")}`))
				.then(reply => CommandResult.fail(message, reply));

		const game = await gamePlugin.createGame(message, { players: {}, joinable: true, aliveCheck: Date.now() });
		if (game) {
			const joined = await gamePlugin.joinGame(message, game);
			if (!joined)
				return this.reply(message, `Failed to join new ${gamePlugin.getGameName()} lobby.`)
					.then(() => CommandResult.pass());

			const lobbyId = this.gameIds.next().value;
			gamePlugin.lobbies.set(lobbyId, game);
			this.callHook("onCreatedGame");

			const createdMessage = await this.reply(message, this.getGameEmbed(game, lobbyId, "Created", true));
			this.handleGameEmbedReactions(message, createdMessage);
		}

		return CommandResult.pass();
	}

	@Command("game join")
	protected async onCommandGameJoin (message: CommandMessage, type: string, lobbyId: string) {
		const gamePlugin = this.gamePlugins.find(plugin => plugin.getId() === type);
		if (!gamePlugin)
			return this.reply(message, `Could not find the game \`${type}\`. Did you mispell it by any chance?`
				.newline(`All games: ${this.gamePlugins.map(plugin => `\`${plugin.getId()}\``).join(", ")}`))
				.then(reply => CommandResult.fail(message, reply));

		const lobby = gamePlugin.lobbies.get(lobbyId);
		if (!lobby)
			return this.reply(message, `Could not find the ${gamePlugin.getGameName()} lobby \`${lobbyId}\`. Did you mispell it by any chance?`
				.newline(`All lobbies: ${gamePlugin.lobbies.keys().map(lobbyId => `\`${lobbyId}\``).toString(", ")}`))
				.then(reply => CommandResult.fail(message, reply));

		if (lobby.players[message.author.id])
			return this.reply(message, `You are already in ${gamePlugin.getGameName()} lobby \`${lobbyId}\`.`)
				.then(reply => CommandResult.fail(message, reply));

		if (!lobby.joinable)
			return this.reply(message, `Sorry, the ${gamePlugin.getGameName()} lobby \`${lobbyId}\` is not joinable.`)
				.then(reply => CommandResult.fail(message, reply));

		const joined = await gamePlugin.joinGame(message, lobby);
		if (!joined)
			return this.reply(message, `Failed to join ${gamePlugin.getGameName()} lobby \`${lobbyId}\`.`)
				.then(() => CommandResult.pass());

		const joinedMessage = await this.reply(message, this.getGameEmbed(lobby, lobbyId, "Joined", true));
		this.handleGameEmbedReactions(message, joinedMessage);

		for (const player of Object.keys(lobby.players))
			if (player !== message.author.id)
				this.guild.members.cache.get(player)
					?.send(this.getGameEmbed(lobby, lobbyId, `${message.member?.displayName ?? message.author.username} joined`));

		this.callHook("onJoined");

		return CommandResult.pass();
	}

	@Command("game")
	protected async onCommandGame (message: CommandMessage) {
		return this.gamePlugins.stream()
			.flatMap(plugin => plugin.lobbies.entries()
				.filter(([, game]) => game.players[message.author.id])
				.map(([lobbyId, game]) => plugin.getGameEmbed(game, lobbyId, undefined, true)))
			.collect(Paginator.create)
			.addOption("📝")
			.event.subscribe("reaction", (paginator, reaction) => {
				if (reaction.name === "📝") {
					paginator.cancel();
					this.reply(message, this.getGameRules());
				}
			})
			.reply(message)
			.then(() => CommandResult.pass());
	}

	@Command("game start")
	protected async onCommandGameStart (message: CommandMessage) {
		const [plugin, lobbyId, game] = this.gamePlugins.stream()
			.flatMap(plugin => plugin.lobbies.entries()
				.filter(([, game]) => game.players[message.author.id])
				.map(([lobbyId, game]) => tuple(plugin, lobbyId, game)))
			.first() ?? [];

		if (!plugin || !lobbyId || !game)
			return this.reply(message, "You are not in a game lobby to start.")
				.then(() => CommandResult.pass());

		plugin.startGame(message, game, lobbyId);
		return CommandResult.pass();
	}

	protected getGameEmbed (game: IGame<any>, lobbyId: string, title = "", reactable = false) {
		return new MessageEmbed()
			.setTitle(`${title} ${this.getGameName()} Lobby \`${lobbyId}\``.trim())
			.setDescription(this.getGameDescription())
			.addField("Status", game.status)
			.addField("Players", `**${Object.keys(game.players).length}** — `
				.join(Object.keys(game.players)
					.map(playerId => this.guild.members.cache.get(playerId)?.displayName ?? playerId)
					.join(", ")))
			.addFields(!reactable ? undefined : { name: Strings.BLANK, value: `📝 View rules of ${this.getGameName()}` });
	}

	private async handleGameEmbedReactions (message: CommandMessage, reactionMessage: ArrayOr<Message>) {
		const { response } = await this.promptReaction(reactionMessage)
			.addOption("📝")
			.reply(message);

		if (response?.name === "📝")
			this.reply(message, this.getGameRules());
	}

	private async joinGame (message: CommandMessage, game: IGame<any>) {
		const inNoLobbies = await this.leaveGames(message);
		if (!inNoLobbies)
			return false;

		const player = await this.createPlayer(message);
		if (!player)
			return false;

		game.players[message.author.id] = player;
		return true;
	}

	private async leaveGame (message: CommandMessage, game: IGame<any>) {
		delete game.players[message.author.id];
		this.callHook("onLeft");
	}

	private async leaveGames (message: CommandMessage) {
		for (const gamePlugin of this.gamePlugins) {
			for (const [lobbyId, game] of gamePlugin.lobbies) {
				if (game.players[message.author.id]) {
					const leaveLobby = await this.yesOrNo(undefined, new MessageEmbed()
						.setTitle(`Are you sure you want to leave ${gamePlugin.getGameName()} lobby ${lobbyId}?`)
						.setDescription("This might impact the game for other players!")
						.setColor("FF0000"))
						.reply(message);

					if (!leaveLobby)
						return false;

					gamePlugin.leaveGame(message, game);
				}
			}
		}

		return true;
	}

	private callHook (hook: string) {
		try {
			(this[hook as keyof this] as any)?.();
		} catch (err) {
			this.logger.error(err);
		}
	}
}