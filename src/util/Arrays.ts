declare global {
	type ArrayOr<T> = T | T[];
}

export function tuple<A extends any[]> (...args: A) {
	return args;
}

module Arrays {
	export function or<T> (v: ArrayOr<T>) {
		return Array.isArray(v) ? v : [v];
	}

	export function shuffle<T> (a: T[]) {
		let j: number, x: T, i: number;
		for (i = a.length - 1; i > 0; i--) {
			j = Math.floor(Math.random() * (i + 1));
			x = a[i];
			a[i] = a[j];
			a[j] = x;
		}

		return a;
	}
}

export default Arrays;
