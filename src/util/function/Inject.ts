type AnyClass<T> = (Function & { prototype: T });
type AnyFunction<R = any> = (...args: any[]) => R;
type NullaryClass<T> = new () => T;

const SYMBOL_INJECTIONS = Symbol("injections");

type IndexedByPosition<T> = { [key in InjectPosition]: T };

interface IndexedByPriority<T> {
	priorities: number[];
	[key: number]: T;
}

type MappedByInjectorClass<T> = Map<IInjectorClass<any>, T>;

type Injections = MappedByInjectorClass<Array<[handler: string | number | symbol | AnyFunction, self: boolean]>>;

type InjectPosition = "pre" | "post";

interface IInjectionClass<T> extends Class<T> {
	/**
	 * keys: method names in T instances to inject into
	 * values: the injections for that method 
	 */
	[SYMBOL_INJECTIONS]: Map<keyof T, IndexedByPosition<IndexedByPriority<Injections>>>;
}

export interface IInjectionApi<T extends { [key in K]: AnyFunction }, K extends keyof T, POS extends InjectPosition> {
	/**
	 * The value of `this` in the original method.
	 */
	readonly this: T;
	/**
	 * The original method (the one injected into).
	 */
	readonly original: T[K];
	/**
	 * The return value of the method call.
	 */
	readonly return: POS extends "pre" ? ReturnType<T[K]> | undefined : ReturnType<T[K]>;
	/**
	 * The arguments given to the method call.
	 */
	arguments: Parameters<T[K]>;
	/**
	 * Whether the original method (the one injected into) should be called.
	 */
	readonly cancelled: boolean;
	/**
	 * Cancels calling the original method. Requires `setReturn()` to also have been called.
	 */
	cancel (): void;
	/**
	 * Replaces the return value of the method call.
	 */
	setReturn (value: ReturnType<T[K]>): void;
}

class InjectionApi<T extends { [key in K]: AnyFunction }, K extends keyof T, POS extends InjectPosition> implements IInjectionApi<T, K, POS> {

	public readonly this: T;
	public arguments: Parameters<T[K]>;
	public get return (): any { return this.returnValue; }
	public get cancelled () { return this.isCancelled; }

	private returnValue: ReturnType<T[K]>;
	private isCancelled = false;

	public constructor (thisValue: T, public readonly original: T[K], args: Parameters<T[K]>) {
		this.this = thisValue;
		this.arguments = args;
	}

	public cancel () {
		this.isCancelled = true;
	}

	public setReturn (value: ReturnType<T[K]>) {
		this.returnValue = value;
	}

	public hasCustomReturn () {
		return "returnValue" in this;
	}
}

type InjectionMethod<T extends { [key in K]: AnyFunction }, K extends keyof T, POS extends InjectPosition> =
	T[K] extends (...args: infer A) => any ? (api: IInjectionApi<T, K, POS>, ...args: A) => any : never;

function handleInjections (api: InjectionApi<any, any, InjectPosition>, injections: IndexedByPriority<Injections>) {
	for (const priority of injections.priorities)
		for (const [injectorClass, handlerProperties] of injections[priority].entries())
			for (const injectorInstance of injectorClass[SYMBOL_INSTANCES] || [])
				if (injectorInstance instanceof injectorClass)
					for (const [handlerProperty, self] of handlerProperties)
						if (!self || injectorInstance === api.this)
							(typeof handlerProperty === "function" ? handlerProperty : injectorInstance[handlerProperty])
								.call(injectorInstance, api, ...api.arguments);
}

function getInjections (injections: IndexedByPriority<Injections>) {
	const result: AnyFunction[] = [];
	for (const priority of injections.priorities)
		for (const [injectorClass, handlerProperties] of injections[priority].entries())
			for (const injectorInstance of injectorClass[SYMBOL_INSTANCES] || [])
				if (injectorInstance instanceof injectorClass)
					for (const [handlerProperty] of handlerProperties)
						result.push(typeof handlerProperty === "function" ? handlerProperty : injectorInstance[handlerProperty]);

	return result;
}

export function Inject<T extends { [key in K]: AnyFunction }, K extends keyof T, POS extends InjectPosition> (injectInto: AnyClass<T>, property: K, position: POS, priority = 0) {
	return injectInternal(injectInto, property, position, priority) as
		(host: any, property2: string | number | symbol, descriptor: TypedPropertyDescriptor<InjectionMethod<T, K, POS>>) => any;
}

const SYMBOL_INSTANCES = Symbol("instances");

interface IInjectorClass<T> extends Class<T> {
	/**
	 * keys: method names in T instances to inject into
	 * values: the injections for that method 
	 */
	[SYMBOL_INSTANCES]?: Set<T>;
}

/**
 * Classes decorated with `Injector` will have their methods automatically injected using `inject`.
 * 
 * **These injections will not be automatically cleaned up.**
 * To prevent a memory leak, make sure you always call `Injector.deregister` on the instance when you're
 * done with it.
 * 
 * Note: Alternatively, if you want to register your injection instances manually on a case-by-case basis, 
 * you can instead use `Injector.register`
 */
export function Injector<T> (constructor: Class<T>) {
	const injectorClass = constructor as IInjectorClass<T>;
	if (!(SYMBOL_INSTANCES in injectorClass)) {
		injectorClass[SYMBOL_INSTANCES] = new Set();
	}

	return class extends (constructor as any) {
		public constructor (...args: any[]) {
			super(...args);
			injectorClass[SYMBOL_INSTANCES]!.add(this as any);
		}
	} as NullaryClass<T>;
}

function injectInternal<T extends { [key in K]: AnyFunction }, K extends keyof T, POS extends InjectPosition> (injectInto: AnyClass<T> | null, property: K, position: POS, priority = 0) {
	return (host: any, property2: string | number | symbol | AnyFunction) => {
		const injectedClass = injectInto as IInjectionClass<T> || host.constructor;
		if (!(SYMBOL_INJECTIONS in injectedClass)) {
			injectedClass[SYMBOL_INJECTIONS] = new Map();
		}

		let injectionsMap = injectedClass[SYMBOL_INJECTIONS].get(property);
		if (!injectionsMap) {
			injectionsMap = {
				pre: { priorities: [] },
				post: { priorities: [] },
			};

			injectedClass[SYMBOL_INJECTIONS].set(property, injectionsMap);

			const originalMethod = injectedClass.prototype[property] as T[K];

			Object.defineProperty(injectedClass.prototype, property, {
				value (this: T, ...args: Parameters<T[K]>) {
					const api = new InjectionApi(this, originalMethod, args);

					handleInjections(api, injectionsMap!.pre);

					if (api.cancelled) {
						if (!api.hasCustomReturn())
							console.error("Injected method was cancelled, but no replacement return value was set.", originalMethod, "Injections:", getInjections(injectionsMap!.pre));

					} else {
						const originalReturnValue = originalMethod.apply(this, args);
						if (!api.hasCustomReturn())
							api.setReturn(originalReturnValue);
					}

					handleInjections(api, injectionsMap!.post);

					return api.return;
				},
			});
		}

		// rather than doing a custom sort or reversing the priorities array,
		// just store the priority inverted
		priority = priority * -1;

		if (!(priority in injectionsMap[position])) {
			injectionsMap[position][priority] = new Map();
			injectionsMap[position].priorities.push(priority);
			injectionsMap[position].priorities.sort();
		}

		const injections = injectionsMap![position][priority].getOrDefault(host.constructor, () => [], true);
		if (!injections.some(([p]) => p === property2))
			injections.push([property2, injectInto === null]);
	};
}

export module Injector {

	export function into<T extends { [key in K]: AnyFunction }, K extends keyof T, POS extends InjectPosition> (injectInto: AnyClass<T> | null, property: K, position: POS, priority = 0) {
		return {
			inject: injectInternal(injectInto, property, position, priority) as
				((host: any, property2: string | number | symbol | AnyFunction) => any),
		};
	}

	/**
	 * Injects the `@Inject`-decorated methods of this class into their respective classes.
	 *
	 * **These injections will not be automatically cleaned up.**
	 * To prevent a memory leak, make sure you always call `Injector.deregister` on the instance when you're
	 * done with it.
	 *
	 * Note: Due to the implementation, this operation is negligible, so don't worry about performance impacts of calling it.
	 * 
	 * Note: If you want your instance's injections to be registered automatically, decorate the class with `@Injector` 
	 */
	export function register<T> (injectorClass: Class<T>, instance: T) {
		const cls = injectorClass as IInjectorClass<T>;
		if (!(SYMBOL_INSTANCES in injectorClass)) {
			cls[SYMBOL_INSTANCES] = new Set();
		}

		cls[SYMBOL_INSTANCES]!.add(instance);
	}

	/**
	 * Removes the injections (`@Inject`-decorated methods) of this class.
	 *
	 * Note: Due to the implementation, this operation is negligible, so don't worry about performance impacts of calling it.
	 */
	export function deregister<T> (injectorClass: Class<T>, instance: T) {
		const cls = injectorClass as IInjectorClass<T>;
		if (SYMBOL_INSTANCES in cls) {
			return cls[SYMBOL_INSTANCES]!.delete(instance);
		}

		return false;
	}
}
