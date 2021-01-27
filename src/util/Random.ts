module Random {
	export function choice<A extends any[]> (...array: A): A[number] {
		return array[Math.floor(Math.random() * array.length)];
	}
}

export default Random;
