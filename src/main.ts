// tslint:disable-next-line
import "@wayward/goodstream/apply";
import "reflect-metadata";

import { fs } from "mz";
import { Config, IConfig, IGuildConfig } from "./core/Config";
import { Ward } from "./core/Ward";
import { sleep } from "./util/Async";
import Logger from "./util/Log";
// @ts-ignore
import Functions = require("./util/Functions");

let wards = new Map<IGuildConfig, Ward>();
let interval = setInterval(async () => {
	if (await fs.exists("update.notify")) {
		fs.unlinkSync("update.notify");
		return exitHandler(new Error("Updating..."));
	}
}, 200);

async function start () {
	const config = await new Config().get();
	Logger.init(config.logging);

	Logger.info(undefined, `Initialized at ${new Date().toLocaleString()}`);

	for (const guildConfig of config.instances)
		createWardInstance(config, guildConfig);
}



function createWardInstance (config: IConfig, guildConfig: IGuildConfig) {
	const ward = new Ward({ ...config, instances: [], ...guildConfig });
	wards.set(guildConfig, ward);
	ward.start();

	ward.event.on("restart", async all => {
		if (all)
			return exitHandler(new Error("Restarting..."));

		await ward.stop();
		createWardInstance(config, guildConfig);
	});
}

async function stop () {
	clearInterval(interval);

	await Promise.race([
		Promise.all(wards.values()
			.map(ward => ward?.stop())),
		sleep(2000),
	]);
}


process.stdin.resume();
start();

async function exitHandler (err?: NodeJS.Signals | Error) {
	if (err !== undefined) {
		console.log(err);
		if (typeof err === "object" && "stack" in err)
			Logger.error("main", err.stack);
	}

	await stop();
	process.exit(err ? 1 : 0);
}

process.on("SIGINT", exitHandler);
process.on("SIGUSR1", exitHandler);
process.on("SIGUSR2", exitHandler);
process.on("uncaughtException", exitHandler);
process.on("unhandledRejection" as any, exitHandler); // ts ur dum
