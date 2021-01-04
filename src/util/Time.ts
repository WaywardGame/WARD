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
	Weeks = "weeks",
	Months = "months",
	Years = "years",
}

const timeAbbreviations: Record<string, TimeUnit> = Object.fromEntries(Object.entries({
	[TimeUnit.Milliseconds]: ["ms"],
	[TimeUnit.Seconds]: ["s", "sec"],
	[TimeUnit.Minutes]: ["m", "min"],
	[TimeUnit.Hours]: ["h", "hr"],
	[TimeUnit.Days]: ["d"],
	[TimeUnit.Weeks]: ["w"],
	[TimeUnit.Months]: ["mo"],
	[TimeUnit.Years]: ["y", "yr"],
}).flatMap(([unit, abbrs]) => abbrs.map(abbr => [abbr, unit as TimeUnit])));

// tslint:disable cyclomatic-complexity
const valRegex = /^([0-9\.]+) ?([a-z]+)$/;
export function getTime (unit: TimeUnit, amt: number): number;
export function getTime (time?: string | [TimeUnit, number]): number;
export function getTime (unit?: TimeUnit | string | [TimeUnit, number], amt?: number) {
	if (typeof unit == "string" && amt === undefined) {
		const match = unit.match(valRegex);
		if (!match)
			return 0;

		amt = +match[1];
		unit = match[2] as TimeUnit;
	}

	else if (unit === undefined)
		return 0;
	else
		unit = unit;

	if (Array.isArray(unit)) {
		amt = unit[1];
		unit = unit[0];
	}

	if (unit in timeAbbreviations)
		unit = timeAbbreviations[unit];

	if (amt === undefined)
		return amt;

	switch (unit) {
		case TimeUnit.Seconds: return seconds(amt);
		case TimeUnit.Minutes: return minutes(amt);
		case TimeUnit.Hours: return hours(amt);
		case TimeUnit.Days: return days(amt);
		case TimeUnit.Weeks: return weeks(amt);
		case TimeUnit.Months: return months(amt);
		case TimeUnit.Years: return years(amt);
		default: return amt;
	}
}

const extractableTimes: [number, string, string?][] = [
	[centuries(1), "century", "centuries"],
	[decades(1), "decade"],
	[years(1), "year"],
	[months(1), "month"],
	[weeks(1), "week"],
	[days(1), "day"],
	[hours(1), "hour"],
	[minutes(1), "minute"],
	[seconds(1), "second"],
	[1, "millisecond"],
];

export function renderTime (ms: number, { lowest = "second", neverString = "never", zero: zeroString = undefined as string | undefined, prefix = "", suffix = "" } = {}) {
	if (ms >= never())
		return neverString;

	if (zeroString === undefined)
		zeroString = prefix + "0 milliseconds" + suffix;

	if (ms < 0)
		return zeroString;

	let result = "";
	for (const extractableTime of extractableTimes) {
		const [extracted, text] = extractTime(ms, ...extractableTime);
		if (extracted) {
			ms -= extracted;
			result += ` ${text},`;
		}

		if (extractableTime[1] === lowest && result)
			break;
	}

	result = result.slice(1, -1);
	if (!result)
		return zeroString;

	return prefix + result + suffix;
}

function extractTime (ms: number, extract: number, singular: string, plural?: string) {
	const extracted = Math.floor(ms / extract);
	if (!extracted)
		return [];

	return [extracted * extract, labelAmount(extracted, singular, plural)] as const;
}

function labelAmount (amount: number, singular: string, plural = `${singular}s`) {
	return `${amount} ${amount === 1 ? singular : plural}`;
}

export function getISODate (date = new Date()) {
	return date.toISOString().slice(0, 10);
}

export function getWeekNumber (date = new Date()) {
	return Math.floor(date.getTime() / weeks(1));
}
