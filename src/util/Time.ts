export function seconds (a: number) {
	return a * 1000;
}

export function minutes (a: number) {
	return a * 1000 * 60;
}

export function hours (a: number) {
	return a * 1000 * 60 * 60;
}

export function days (a: number) {
	return a * 1000 * 60 * 60 * 24;
}

export function weeks (a: number) {
	return a * 1000 * 60 * 60 * 24 * 7;
}

export function months (a: number) {
	return a * 1000 * 60 * 60 * 24 * 7 * 4.34524166667;
}

export function years (a: number) {
	return a * 1000 * 60 * 60 * 24 * 7 * 52.1429;
}

// why not
export function decades (a: number) {
	return a * 1000 * 60 * 60 * 24 * 7 * 52.1429 * 10;
}

export function centuries (a: number) {
	return a * 1000 * 60 * 60 * 24 * 7 * 52.1429 * 100;
}

export function never () {
	return Infinity;
}

export enum TimeUnit {
	Milliseconds = "milliseconds",
	Seconds = "seconds",
	Minutes = "minutes",
	Hours = "hours",
	Days = "days",
}

// tslint:disable cyclomatic-complexity
const valRegex = /([0-9\.]+) ?([a-z]+)/;
export function getTime (unit: TimeUnit, amt: number): number;
export function getTime (time: string | [TimeUnit, number]): number;
export function getTime (unit: TimeUnit | string | [TimeUnit, number], amt?: number) {
	if (typeof unit == "string" && amt === undefined) {
		const match = unit.match(valRegex);
		amt = +match[1];
		unit = match[2] as TimeUnit;

	} else {
		unit = unit;
	}

	if (Array.isArray(unit)) {
		amt = unit[1];
		unit = unit[0];
	}

	switch (unit) {
		case TimeUnit.Seconds: return seconds(amt);
		case TimeUnit.Minutes: return minutes(amt);
		case TimeUnit.Hours: return hours(amt);
		case TimeUnit.Days: return days(amt);
		default: return amt;
	}
}
