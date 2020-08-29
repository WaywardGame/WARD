module Strings {
	export function sentence (text: string) {
		return text[0].toUpperCase() + text.slice(1);
	}

	const regexNewline = /\n/g;
	export function indent (text: string, level = 1) {
		const indent = level === 1 ? "\t" : "\t".repeat(level);
		return indent + text.replace(regexNewline, "\n" + indent);
	}
}

export default Strings;
