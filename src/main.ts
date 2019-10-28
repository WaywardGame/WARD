// tslint:disable-next-line
import "reflect-metadata";
import "@wayward/goodstream/apply";

import { Config } from "./core/Config";
import { Ward } from "./core/Ward";
import { sleep } from "./util/Async";
import { Logger } from "./util/Log";

let wards: Ward[] = [];

async function start () {
	Logger.setShouldSaveLog();
	const configs = await new Config().get();
	wards = configs.map(config => new Ward(config));
	for (const ward of wards) ward.start();
}
async function stop () {
	await Promise.race([
		Promise.all(wards.map(ward => ward && ward.stop())),
		sleep(2000),
	]);
}

process.stdin.resume();
start();

async function exitHandler (err?: NodeJS.Signals | Error) {
	if (err && typeof err === "object" && "stack" in err) {
		// tslint:disable-next-line no-console
		Logger.log("main", err.stack);
	}

	await stop();
	process.exit(err ? 1 : 0);
}

process.on("SIGINT", exitHandler);
process.on("SIGUSR1", exitHandler);
process.on("SIGUSR2", exitHandler);
process.on("uncaughtException", exitHandler);
process.on("unhandledRejection", exitHandler);
