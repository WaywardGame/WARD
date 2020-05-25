declare global {
	type ArrayOr<T> = T | T[];
}

module Arrays {
	export function or<T> (v: ArrayOr<T>) {
		return Array.isArray(v) ? v : [v];
	}
}

export default Arrays;
