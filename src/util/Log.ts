import chalk from "chalk";
import * as fs from "mz/fs";

export module Logger {
	const waitToLog: string[] = [];
	let isReadyToLog = false;

	export async function log (from?: string, ...what: any[]) {
		const time = new Date().toLocaleTimeString();
		// tslint:disable-next-line no-console
		console.log(chalk.grey(time), what.length == 0 ? from : chalk.grey(`[${from}]`), ...what);

		waitToLog.push([time, what.length == 0 ? from : `[${from}]`, ...what].join(" "));

		if (isReadyToLog) {
			const toLog = waitToLog.slice();
			waitToLog.length = 0;
			isReadyToLog = false;

			if (from == "logger") {
				toLog.unshift("\n");
			}

			for (const message of toLog) {
				await fs.appendFile("logs/ward.log", `${message}\n`);
			}

			isReadyToLog = true;
		}
	}

	export function setShouldSaveLog () {
		function readyToLog () {
			isReadyToLog = true;

			// tslint:disable-next-line no-use-before-declare
			log("logger", `Initialized at ${new Date().toLocaleString()}`);
		}

		fs.mkdir("logs")
			.then(readyToLog, readyToLog)
			.catch(err => {
				if (err.code !== "EEXIST") {
					throw err;
				}
			});
	}
}
