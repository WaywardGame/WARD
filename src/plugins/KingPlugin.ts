import { GuildMember, MessageEmbed } from "discord.js";
import { CommandMessage, IField, ImportPlugin } from "../core/Api";
import GamePlugin, { IGame, IGameBase } from "../core/GamePlugin";
import { tuple } from "../util/Arrays";
import { sleep } from "../util/Async";
import Enums from "../util/Enums";
import Strings from "../util/Strings";
import { minutes } from "../util/Time";
import PronounsPlugin from "./PronounsPlugin";

enum Unit {
	"🗡",
	"2️⃣",
	"3️⃣",
	"4️⃣",
	"5️⃣",
	"6️⃣",
	"7️⃣",
	"👑"
}

// type Assassin = "🗡";
type King = "👑";
type Soldier = Exclude<keyof typeof Unit, King>;

interface IWarResult {
	winner?: GuildMember;
	units?: Soldier[];
}

interface IKingPlayer {
	armies: Soldier[];
	reserves: Soldier[];
	king: boolean;
	usedKingThisRound: boolean;
	deathby?: keyof typeof KingDeathBy;
}

enum KingDeathBy {
	hesitance,
	assassination,
	attrition,
}

enum KingStatus {
	"Waiting for players",
	"Round 1",
	"Round 2",
	"Round 3",
}

interface IKingGame extends IGame<IKingPlayer> {
	status: keyof typeof KingStatus;
}

export default class KingPlugin extends GamePlugin<IKingGame> {

	@ImportPlugin("pronouns")
	private pronouns: PronounsPlugin = undefined!;

	public getDefaultId () {
		return "king";
	}

	protected initData: undefined;

	public shouldExist (config: unknown) {
		return !!config;
	}

	public getGameName () {
		return "King";
	}

	public getGameDescription () {
		return "Utilise your king and armies to conquer your enemies in a battle of strength and will.";
	}

	public getGameRules () {
		return new MessageEmbed()
			.setTitle(`${this.getGameName()} Rules`)
			.addField("1. Units", `Each player has eight units: ${Enums.keys(Unit).join(", ")}. The combat strength of each unit is 1 through 8.`)
			.addField("2. Battles", "The game consists of battles. All players with units remaining must participate by sending one of their units.")
			.addField(`${Strings.INDENT}2a. Victor`, `> The highest combat strength wins, with the exception that the 🗡 unit can assassinate the 👑.`)
			.addField(`${Strings.INDENT}2b. Wars`, `> When two or more players have the highest, but equivalent combat strength, these players must send another unit. This continues until one player wins. If everyone runs out of units with it still a stalemate, all players get their units back from the war.`)
			.addField(`${Strings.INDENT}2c. Spoils`, `> The winner of each battle takes all units used, and puts them into reserve.`)
			.addField("3. Rounds", "Once there are no longer enough players with units to have a battle, the round ends. All players are given a shuffled set of units from their reserves, along with their king, for the next round.")
			.addField("4. Losing", "Players that run out of units in their hand and in reserve are defenseless, and lose. Players that lose their king to a war or to assassination lose.")
			.addField("5. Endgame", "The game ends after three rounds, or when there's only one player remaining. If there are multiple players left, the winner is the one with the greatest overall combat strength.");
	}

	protected createGame (message: CommandMessage, game: IGameBase<IKingPlayer>): IKingGame {
		return {
			...game,
			status: "Waiting for players",
		};
	}

	protected createPlayer (message: CommandMessage): IKingPlayer {
		return {
			armies: [],
			king: true,
			usedKingThisRound: false,
			reserves: [],
		}
	}

	protected async startGame (message: CommandMessage, game: IKingGame, lobbyId: string): Promise<any> {
		if (game.status !== "Waiting for players")
			return this.reply(message, "The game has already been started!");

		if (Object.keys(game.players).length < 2)
			return this.reply(message, `There aren't enough players to play ${this.getGameName()} 😭`);

		const players = Object.keys(game.players)
			.map(player => this.guild.members.cache.get(player))
			.filterNullish();

		const results = await Promise.race([
			sleep(minutes(5)),
			Promise.all(players.filter(player => player.id !== message.author.id)
				.map(player => this.yesOrNo(undefined, new MessageEmbed()
					.setTitle(`Are you ready to start playing ${this.getGameName()}?`)
					.setDescription(`${message.member?.displayName ?? message.author.username} requested the game to be started.`))
					.send(player))),
		]);

		if (!results) {
			for (const player of players)
				player.send("The request to start the game timed out 😭");
			return;
		}

		if (results.includes(false)) {
			for (const player of players)
				player.send("The request to start the game was rejected 😭");
			return;
		}

		for (const player of players)
			player.send(`${this.getGameName()} has begun!`);

		game.joinable = false;
		this.resetGame(game);

		for (let i = 0; i < 3; i++) {
			game.status = `Round ${i + 1}` as keyof typeof KingStatus;
			await this.handleRound(game, players);
			const livingPlayers = players.filter(player => game.players[player.id].king);
			if (livingPlayers.length < 2)
				break;
		}

		for (const player of Object.values(game.players))
			player.reserves.push(...player.armies.splice(0, Infinity));

		const playersSortedByCombatStrength = players
			.map(player => ({
				player,
				combatStrength: game.players[player.id].reserves.reduce((prev, curr) => prev + Unit[curr] + 1, 0)
			}))
			.sort(({ combatStrength: ca }, { combatStrength: cb }) => ca - cb)
			.map(({ player, combatStrength }): IField & { player: GuildMember, combatStrength: number } => ({
				player,
				combatStrength,
				name: player.displayName,
				value: `Combat strength: **${combatStrength}**, Units: ${game.players[player.id].reserves.sort((ua, ub) => Unit[ua] - Unit[ub]).join(", ")}`
			}));

		const livingPlayers = players.filter(player => game.players[player.id].king);
		if (livingPlayers.length === 0)
			for (const player of players)
				player.send(new MessageEmbed()
					.setTitle("Somehow, everyone lost!")
					.setDescription("How did you even manage that?")
					.addField(Strings.BLANK, "**__Final Details__**")
					.addFields(...playersSortedByCombatStrength));

		else if (livingPlayers.length === 1)
			for (const player of players)
				player.send(new MessageEmbed()
					.setTitle(livingPlayers.includes(player) ? "All your enemies vanquished, your king still standing... you won!" : `${livingPlayers[0].displayName} vanquished all ${this.pronouns.referTo(livingPlayers[0]).their} enemies and won!`)
					.addField(Strings.BLANK, "**__Final Details__**")
					.addFields(...playersSortedByCombatStrength));

		else {
			const playersWithHighestCombatStrength: GuildMember[] = [];
			let highestCombatStrength = 0;
			for (const { player, combatStrength } of playersSortedByCombatStrength)
				if (combatStrength > highestCombatStrength) {
					highestCombatStrength = combatStrength;
					playersWithHighestCombatStrength.splice(0, Infinity, player);
				} else if (combatStrength === highestCombatStrength)
					playersWithHighestCombatStrength.push(player);

			for (const player of players)
				player.send(new MessageEmbed()
					.setTitle(!playersWithHighestCombatStrength.includes(player) ? `${playersWithHighestCombatStrength.map(player => player.displayName).join(", ")} won!`
						: playersWithHighestCombatStrength.length === 1 ? "Your king still standing, your armies overpowering your neighbours... you won!"
							: "Your king still standing, your armies not lesser than your neighbours... you won!")
					.addField(Strings.BLANK, "**__Final Details__**")
					.addFields(...playersSortedByCombatStrength));
		}

		game.status = "Waiting for players";
	}

	private async handleRound (game: IKingGame, players: GuildMember[]) {
		for (const player of players)
			game.players[player.id].usedKingThisRound = false;

		while (players.every(player => game.players[player.id].armies.length)) {
			const warResult = await this.handleBattle(game, players);
			(Unit as any)["👑"] = 8; // reset king value
			this.handleWarResult(game, warResult);

			for (const player of players)
				game.players[player.id].reserves.push(...game.players[player.id].armies.splice(0, Infinity));

			for (const member of players) {
				const player = game.players[member.id];
				if (!player.reserves.length) {
					member.send(new MessageEmbed()
						.setTitle("Your armies exhausted, the faith of your people faded... your king dies alone.")
						.setDescription("You ran out of units.")
						.setColor("FF0000"));

					player.king = false;
					player.deathby = "attrition";
				}
			}
		}

		this.shuffleRound(game);
	}

	private handleWarResult (game: IKingGame, result: IWarResult) {
		if (result.winner)
			game.players[result.winner.id].reserves.push(...result.units ?? []);
	}

	private async handleBattle (game: IKingGame, players: GuildMember[]): Promise<IWarResult> {
		if (players.some(player => !game.players[player.id].armies.length))
			return {};

		const killedPlayers: GuildMember[] = [];
		const actions = await Promise.all(players.map(player => this.handlePlayerAction(game, player)));
		for (const { player } of actions.filter(({ unit }) => unit === undefined)) {
			player.send(new MessageEmbed()
				.setTitle("Your hesitance is your flaw... you have perished by your own hand.")
				.setDescription("You didn't send a unit to battle within the time alotted.")
				.setColor("FF0000"));

			game.players[player.id].king = false;
			game.players[player.id].deathby = "hesitance";
			killedPlayers.push(player);
		}

		const isAssassinPressent = actions.some(({ unit }) => unit === "🗡");
		if (isAssassinPressent) {
			for (const { player } of actions.filter(({ unit }) => unit === "👑")) {
				player.send(new MessageEmbed()
					.setTitle("Your king has been assassinated!")
					.setColor("FF0000"));

				game.players[player.id].king = false;
				game.players[player.id].deathby = "assassination";
				killedPlayers.push(player);
			}
		}

		const playersWithActions = actions.filter(({ unit }) => unit !== undefined);
		(Unit as any)["👑"] = isAssassinPressent ? -1 : 8;
		const playersByCombatStrength = playersWithActions.sort(({ unit: ua }, { unit: ub }) => Unit[ub!] - Unit[ua!]);
		const playerWithHighestCombatStrength = playersByCombatStrength[0];

		const equivalentPlayers: GuildMember[] = [playerWithHighestCombatStrength.player];

		for (let i = playersByCombatStrength.length - 1; i > 0; i--)
			if (playersByCombatStrength[i].unit === playerWithHighestCombatStrength.unit)
				equivalentPlayers.push(playersByCombatStrength[i].player);

		await Promise.all(this.getPlayers(game)
			.map(player => player.send(new MessageEmbed()
				.setTitle(killedPlayers.includes(player) ? "Your king was killed!"
					: !players.includes(player) ? "Your king is gone, but the battles rage on!"
						: !equivalentPlayers.includes(player) ? "Your army lost the battle!"
							: equivalentPlayers.length > 1 ? "The battle grows in scale!"
								: "Your army won the battle!")
				.addFields(!killedPlayers.length ? undefined : { name: Strings.BLANK, value: "**__Deaths__**" },
					...killedPlayers.map(player => ({ name: player.displayName, value: `Death by ${game.players[player.id].deathby}` })))
				.addField(Strings.BLANK, "**__Combat Details__**")
				.addFields(...playersWithActions.map(({ player, unit }) => ({ name: player.displayName, value: unit }))))))

		let warResult: IWarResult | undefined;
		if (equivalentPlayers.length > 1) {
			warResult = await this.handleBattle(game, equivalentPlayers);
		}

		if (warResult && !warResult.winner)
			// if there was a war and nobody won, nobody loses any units
			return {};

		const units: Soldier[] = [];
		for (const { player: member, unit } of playersWithActions) {
			if (unit === "👑")
				continue;

			units.push(unit as Soldier);
			game.players[member.id].armies.splice(game.players[member.id].armies.indexOf(unit as Soldier), 1);
		}

		return { winner: warResult && warResult.winner || playerWithHighestCombatStrength.player, units };
	}

	private async handlePlayerAction (game: IKingGame, member: GuildMember) {
		const player = game.players[member.id];
		const units = [...player.armies, ...player.usedKingThisRound ? [] : ["👑" as const]];
		const message = await member.send(new MessageEmbed()
			.setTitle("Time for battle!")
			.addField("Your units", units.sort((a, b) => Unit[a] - Unit[b]).join(", "))
			// .addField("In reserve (not playable)", player.reserves.sort((a, b) => Unit[a] - Unit[b]).join(", "))
			.addField(Strings.BLANK, "**__Choose a unit to send!__**"));

		const { response } = await this.promptReaction(message)
			.addOptions(...[...new Set(units)].map(army => tuple(army)))
			.setTimeout(minutes(1))
			.reply(member.user);

		return { player: member, unit: response?.name as keyof typeof Unit | undefined };
	}

	private resetGame (game: IKingGame) {
		game.status = "Round 1";
		for (const player of Object.values(game.players)) {
			player.king = true;
			player.reserves = [];
			player.armies = [...Enums.keys(Unit).filter(u => u !== "👑") as Soldier[]];
		}
	}

	private shuffleRound (game: IKingGame) {
		for (const player of Object.values(game.players)) {
			if (player.reserves.length <= 7)
				player.armies = player.reserves, player.reserves = [];

			else for (let i = 0; i < 7; i++) {
				player.armies.push(...player.reserves.splice(Math.floor(Math.random() * player.reserves.length), 1));
			}
		}
	}
}