import { Client } from "discord.js";
import config from "../Config";

const discord = new Client();

config.get().then((cfg) => {
	discord.login(cfg.discord.token);
});

export default discord;
