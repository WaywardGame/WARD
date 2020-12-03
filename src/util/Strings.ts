module Strings {
	export function sentence (text: string) {
		return text[0].toUpperCase() + text.slice(1);
	}

	export function trailing (length: number, text: string) {
		if (text.length < length)
			return text;

		return `${text.slice(0, length - 3)}...`;
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

	const validProtocols = new Set(["http:", "https:"]);
	export const URL_VALID_PROTOCOL_REGEX = /^https?:/;

	export function isURL (str: string, host?: string) {
		let url: URL;

		try {
			url = new URL(str);
			if (host && url.host !== host)
				return false;

		} catch {
			return false;
		}

		return validProtocols.has(url.protocol);
	}

	const SYMBOL_SEARCH_TERMS = Symbol("SEARCH_TERMS");

	type SearchTerms<T> = T & {
		[SYMBOL_SEARCH_TERMS]: {
			hash: number;
			lowercase?: string;
			terms: string[];
		};
	};

	export function searchOnKey<T extends { [key in K]: string }, K extends keyof T> (query: string[], items: { data: T; id?: any }[], key: K) {
		for (const { data } of items)
			(data as SearchTerms<T>)[SYMBOL_SEARCH_TERMS] = {
				...(data as SearchTerms<T>)[SYMBOL_SEARCH_TERMS],
				lowercase: data[key].toLowerCase(),
			};

		return basicSearch(query, items);
	}

	export function searchBy<T> (query: string[], items: { data: T; id?: any }[], getSearchableString: (item: T) => string) {
		for (const { data } of items)
			(data as SearchTerms<T>)[SYMBOL_SEARCH_TERMS] = {
				...(data as SearchTerms<T>)[SYMBOL_SEARCH_TERMS],
				lowercase: getSearchableString(data).toLowerCase(),
			};

		return basicSearch(query, items);
	}

	function basicSearch<T> (query: string[], items: { data: T; id?: any }[]) {
		return customSearch(query, items,
			data => Strings.hash((data as SearchTerms<T>)[SYMBOL_SEARCH_TERMS].lowercase!),
			data => (data as SearchTerms<T>)[SYMBOL_SEARCH_TERMS].lowercase!.split(/\s+/g));
	}

	export function customSearch<T> (query: string[], items: { data: T; id?: any }[], hash: (data: T) => number, getTerms: (data: T) => string[]) {
		return items
			.map(({ data, id }) => ({ data, id, value: getQueryValue(data as SearchTerms<T>, id, query, hash, getTerms) }))
			.filter(({ value }) => value)
			.sort(({ value: a }, { value: b }) => b - a);
	}

	function getQueryValue<T> (data: SearchTerms<T>, id: any, query: string[], hashFunction: (data: T) => number, getTerms: (data: T) => string[]) {
		const hash = hashFunction(data);

		let nameSearch = data[SYMBOL_SEARCH_TERMS];
		if (!nameSearch || nameSearch.hash !== hash) {
			nameSearch = data[SYMBOL_SEARCH_TERMS] = {
				...data[SYMBOL_SEARCH_TERMS],
				hash,
				terms: getTerms(data),
			};
		}

		let value = 0;
		for (const queryTerm of query)
			if (queryTerm === id)
				value = 10000;
			else if (!nameSearch.terms.includes(queryTerm))
				return 0;

		return value + nameSearch.terms.reduce((prev, curr) => prev + (query.includes(curr) ? 100 : -1), 0);
	}
}

export default Strings;
