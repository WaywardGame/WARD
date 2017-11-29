/// <reference types="chai-as-promised" />

declare namespace Chai {
	interface PromisedAssertion extends Eventually, Promise<any> {
		then<TResult1 = any, TResult2 = never>(onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
	}
}
