type Mutable<T> = {
	-readonly [P in keyof T]: T[P]
};

type PartialUnion<A, B> = (A & Undefined<B>) | (B & Undefined<A>);

type Undefined<T> = { [K in keyof T]?: undefined };

type ArrayOrReadonlyArray<T> = T[] | readonly T[];
