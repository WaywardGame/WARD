module Maths {
	export function sum (...ns: number[]) {
		return ns.reduce((accum, n) => accum + n, 0);
	}
}

export default Maths;
