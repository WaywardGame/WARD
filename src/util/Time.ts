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
