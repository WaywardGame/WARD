module Regex {
	const regexregex = /^\/(.*)\/([gmiysu]*)$/;
	export function parse (regex: string): RegExp | null {
		const match = regex.match(regexregex);
		return match && new RegExp(match[1], match[2]);
	}
}

export default Regex;
