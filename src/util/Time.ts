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

export function getTime (unit: TimeUnit, a: number) {
	switch (unit) {
		case TimeUnit.Seconds: return seconds(a);
		case TimeUnit.Minutes: return minutes(a);
		case TimeUnit.Hours: return hours(a);
		case TimeUnit.Days: return days(a);
		default: return a;
	}
}
