declare global {
	type GetterOr<T, A extends any[] = []> = T | ((...args: A) => T);
}

export = 0;
