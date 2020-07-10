// tslint:disable-next-line
import "@wayward/goodstream/apply";
import "reflect-metadata";
import { Config } from "./core/Config";
import { Ward } from "./core/Ward";
import { sleep } from "./util/Async";
import Logger from "./util/Log";
// @ts-ignore
import Functions = require("./util/Functions");

let wards: Ward[] = [];

async function start () {
	const config = await new Config().get();
	Logger.init(config.logging);

	Logger.info(undefined, `Initialized at ${new Date().toLocaleString()}`);

	wards = config.instances.map(instanceConfig =>
		new Ward({ ...config, instances: [], ...instanceConfig }));

	for (const ward of wards)
		ward.start();
}

async function stop () {
	await Promise.race([
		Promise.all(wards.map(ward => ward?.stop())),
		sleep(2000),
	]);
}


process.stdin.resume();
start();

async function exitHandler (err?: NodeJS.Signals | Error) {
	if (err && typeof err === "object" && "stack" in err) {
		// tslint:disable-next-line no-console
		Logger.info("main", err.stack);
	}

	await stop();
	process.exit(err ? 1 : 0);
}

process.on("SIGINT", exitHandler);
process.on("SIGUSR1", exitHandler);
process.on("SIGUSR2", exitHandler);
process.on("uncaughtException", exitHandler);
process.on("unhandledRejection" as any, exitHandler); // ts ur dum
