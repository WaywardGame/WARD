import ogs = require("open-graph-scraper");
import Logger from "./Log";

module Scrape {

	export interface IEmbedDetails {
		link?: string;
		title?: string;
		description?: string;
		thumbnail?: string;
		message?: string;
		fields?: [string, string][];
		otherLinks?: string[];
	}

	export async function extractGDocs (text: string, preserveLinks = false): Promise<IEmbedDetails | undefined> {
		const regex = /\bhttps:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)(\/edit)?(\?(&?(usp=(sharing|drivesdk)|pli=1))*)?(#(heading=h\.\w+)?)?/;
		const match = text.match(regex);
		if (!match)
			return undefined;

		const gdocsLink = match[0];

		const embed = await extractOpenGraph(gdocsLink);
		if (!embed)
			return undefined;

		const before = text.slice(0, match.index);
		let after = text.slice(match.index! + gdocsLink.length);
		let link = "";

		if (embed.title && (regex.test(after) || preserveLinks)) {
			link = `[${embed.title}](${gdocsLink})`;
			const extracted = await extractGDocs(after, true);
			after = extracted?.message ?? "";
			if (extracted?.link || extracted?.otherLinks?.length) {
				embed.otherLinks ??= [];
				embed.otherLinks.push(extracted.link!, ...extracted.otherLinks ?? []);
			}
		}

		embed.message = `${before}${link}${after}`;

		return embed;
	}

	export async function extractOpenGraph (link: string): Promise<IEmbedDetails> {
		let title: string | undefined;
		let description: string | undefined;
		let thumbnail: string | undefined;

		const ogData = await ogs({ url: link });
		if (ogData.error) {
			Logger.warning("Scraper", "Could not get Open Graph data for link", link, ogData.result);
		} else {
			title = ogData.result.ogTitle;
			description = ogData.result.ogDescription;
			thumbnail = ogData.result.ogImage?.url;
		}

		return { link, title, description, thumbnail };
	}
}

export default Scrape;
