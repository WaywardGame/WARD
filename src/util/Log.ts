import chalk from "chalk";

export module Logger {
	export function log (from?: string, ...what: any[]) {
		const time = chalk.grey(`${new Date().toLocaleTimeString()}`);
		// tslint:disable-next-line no-console
		console.log(time, what.length == 0 ? from : chalk.grey(`[${from}]`), ...what);
	}
}
