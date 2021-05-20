module Objects {
	export function followKeys<O extends object, K extends Extract<keyof Flatten<O>, string>> (object: O, keys: K): Flatten<O>[K] {
		const path = keys.split(".");
		for (const property of path)
			object = (object as any)?.[property];

		return object as any;
	}
}

export default Objects;
