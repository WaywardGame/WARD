module Strings {
	export function sentence (text: string) {
		return text[0].toUpperCase() + text.slice(1);
	}

	const regexNewline = /\n/g;
	export function indent (text: string, level = 1) {
		const indent = level === 1 ? "\t" : "\t".repeat(level);
		return indent + text.replace(regexNewline, "\n" + indent);
	}

	export function hash (text: string) {
		var hash = 0, i, chr;
		for (i = 0; i < text.length; i++) {
			chr = text.charCodeAt(i);
			hash = ((hash << 5) - hash) + chr;
			hash |= 0; // Convert to 32bit integer
		}
		return hash;
	}
}

export default Strings;
