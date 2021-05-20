type Mutable<T> = {
	-readonly [P in keyof T]: T[P]
};

type PartialUnion<A, B> = (A & Undefined<B>) | (B & Undefined<A>);

type Undefined<T> = { [K in keyof T]?: undefined };

type ArrayOrReadonlyArray<T> = T[] | readonly T[];

type Class<T, A extends any[] = any[]> = new (...args: A) => T;

type RecursiveOptional<T> = { [K in keyof T]?: RecursiveOptional<T[K]> };

type Flatten<T extends object> = string extends keyof T ? object : {
	[K in keyof T]-?: (x: NonNullable<T[K]> extends infer V ? V extends object ?
		V extends readonly any[] ? Pick<T, K> : (Flatten<V> extends infer FV ? ({
			[P in keyof FV as `${Extract<K, string | number>}.${Extract<P, string | number>}`]:
			FV[P] }) : never) & Pick<T, K> : Pick<T, K> : never
	) => void } extends Record<keyof T, (y: infer O) => void> ?
	O extends infer U ? { [K in keyof O]: O[K] } : never : never;

type AnyFunction = (...args: any[]) => any;
