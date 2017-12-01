// tslint:disable-next-line
import "reflect-metadata";

import { Config } from "./core/Config";
import { Ward } from "./core/Ward";
import { sleep } from "./util/Async";

let ward: Ward;

async function start () {
	const config = await new Config().get();
	ward = new Ward(config);
	ward.start();
}
async function stop () {
	await Promise.race([
		ward.stop(),
		sleep(2000),
	]);
}

process.stdin.resume();
start();

async function exitHandler (err?: Error) {
	if (err) {
		// tslint:disable-next-line no-console
		console.log(err.stack);
	}

	await stop();
	process.exit();
}

process.on("SIGINT", exitHandler);
process.on("SIGUSR1", exitHandler);
process.on("SIGUSR2", exitHandler);
process.on("uncaughtException", exitHandler);
process.on("unhandledRejection", exitHandler);
