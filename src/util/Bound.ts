type AnyFunction = (...args: any[]) => any;

export default function (target: any, key: string | number | symbol, descriptor: TypedPropertyDescriptor<AnyFunction>) {
	return getTypedPropertyDescriptor(target, key, descriptor, true);
}

export function Final (target: any, key: string | number | symbol, descriptor: TypedPropertyDescriptor<AnyFunction>) {
	return getTypedPropertyDescriptor(target, key, descriptor, false);
}

const allTimeouts = new Map<AnyFunction, NodeJS.Timer>();
export function Debounce (ms: number) {
	return (target: any, key: string | number | symbol, descriptor: TypedPropertyDescriptor<AnyFunction>) => {
		const timeouts = new Map();
		return getTypedPropertyDescriptor(target, key, descriptor, true, (boundFn, boundTo) => {
			const result = (...args: any[]) => {
				const boundToTimeouts = timeouts.get(boundTo) || new Map();
				timeouts.set(boundTo, boundToTimeouts);

				clearTimeout(boundToTimeouts.get(key));
				const timeout = setTimeout(() => boundFn(...args), ms);
				boundToTimeouts.set(key, timeout);
				allTimeouts.set(result, timeout);
			};

			return result;
		});
	};
}

export module Debounce {
	export function cancel (fn: AnyFunction) {
		clearTimeout(allTimeouts.get(fn)!);
	}
}

function getTypedPropertyDescriptor (target: any, key: string | number | symbol, descriptor: TypedPropertyDescriptor<AnyFunction>, configurable = true, getter?: (boundFn: any, boundTo: any) => any) {
	let fn = descriptor.value;

	return {
		configurable,
		get () {
			if (!this || this === target.prototype || this.hasOwnProperty(key) || typeof fn !== "function") {
				return fn;
			}

			const boundTo = this;
			const boundFn = fn.bind(boundTo);
			const actualReturnedFn = getter ? getter(boundFn, boundTo) : boundFn;
			Object.defineProperty(this, key, {
				configurable,
				get () {
					return actualReturnedFn;
				},
				set (value) {
					fn = value;
					delete this[key];
				}
			});

			return actualReturnedFn;
		},
		set (value: any) {
			fn = value;
		}
	};
}
