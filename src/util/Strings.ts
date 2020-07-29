module Strings {
	export function sentence (text: string) {
		return text[0].toUpperCase() + text.slice(1);
	}
}

export default Strings;
