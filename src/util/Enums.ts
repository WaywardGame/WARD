
export module EnumProperty {
	export const EXCLUDED = Symbol("EXCLUDED");
	export const KEYS = Symbol("KEYS");
	export const KEYSET = Symbol("KEYSET");
	export const VALUES = Symbol("VALUES");
	export const VALUESET = Symbol("VALUESET");
	export const ENTRIES = Symbol("ENTRIES");
}

export type EnumObject<T> = T & {
	[EnumProperty.EXCLUDED]?: Set<keyof T>;
	[EnumProperty.KEYS]?: (keyof T)[];
	[EnumProperty.KEYSET]?: Set<keyof T>;
	[EnumProperty.VALUES]?: (T[keyof T])[];
	[EnumProperty.VALUESET]?: Set<T[keyof T]>;
	[EnumProperty.ENTRIES]?: ([keyof T, T[keyof T]])[];
};

export module EnumObject {
	export function get<E> (enumObject: E) {
		return enumObject as EnumObject<E>;
	}

	/**
	 * Sets the enum keys that won't be iterated over in the enum.
	 */
	export function setExcluded<E> (enumObject: E, ...keys: (keyof E)[]) {
		(enumObject as any)[EnumProperty.EXCLUDED] = new Set(keys);
	}
}

module Enums {
	/**
	 * Get the names of the entries in an enum.
	 */
	export function keys<T> (enumObject: T) {
		const e = EnumObject.get(enumObject);
		if (!e[EnumProperty.KEYS])
			e[EnumProperty.KEYS] = (Object.keys(e) as (PropertyKey[]))
				.filter((key): key is Extract<keyof T, string | number> => isNaN(Number(key))
					&& !e[EnumProperty.EXCLUDED]?.has(key as any));

		return e[EnumProperty.KEYS]!;
	}

	/**
	 * Returns whether the given name has a value in the given enum.
	 */
	export function hasKey<T> (enumObject: T, name: unknown): name is keyof T {
		const e = EnumObject.get(enumObject);
		if (!e[EnumProperty.KEYSET])
			e[EnumProperty.KEYSET] = new Set(keys(enumObject));

		return e[EnumProperty.KEYSET]!.has(name as any);
	}

	/**
	 * Get the values in an enum.
	 */
	export function values<T> (enumObject: T) {
		const e = EnumObject.get(enumObject);
		if (!e[EnumProperty.VALUES])
			e[EnumProperty.VALUES] = keys(enumObject)
				.map(key => enumObject[key]);

		return e[EnumProperty.VALUES]!;
	}

	/**
	 * Returns whether the given value is an entry in the given enum.
	 */
	export function has<T> (enumObject: T, value: unknown): value is T[keyof T] {
		const e = EnumObject.get(enumObject);
		if (!e[EnumProperty.VALUESET])
			e[EnumProperty.VALUESET] = new Set(values(enumObject));

		return e[EnumProperty.VALUESET]!.has(value as any);
	}

	/**
	 * Get the entries in an enum. Yields a tuple containing the name and value of each entry.
	 */
	export function entries<T> (enumObject: T) {
		const e = EnumObject.get(enumObject);
		if (!e[EnumProperty.ENTRIES])
			e[EnumProperty.ENTRIES] = keys(enumObject)
				.map(key => [key, enumObject[key]]);

		return e[EnumProperty.ENTRIES]!;
	}

	export function invalidateCache (enumObject: any) {
		const e = EnumObject.get(enumObject);
		for (const enumSymbolProperty of Object.values(EnumProperty))
			delete e[enumSymbolProperty];
	}
}

export default Enums;
