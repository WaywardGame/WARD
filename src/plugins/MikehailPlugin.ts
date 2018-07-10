import { Message } from "discord.js";

import { Plugin } from "../core/Plugin";
import { RegularsPlugin } from "./RegularsPlugin";
import { ImportPlugin } from "../core/Api";

export class MikehailPlugin extends Plugin<{}> {
	@ImportPlugin("regulars")
	private regularsPlugin: RegularsPlugin = undefined;

	public getDefaultId () {
		return "mikehail";
	}

	public onCommand (message: Message, command: string, ...args: string[]) {
		const commandText = [command, ...args];
		if (commandText.includes("chicken")) {
			if (commandText.includes("sandwich")) return this.commandHowCloseToNextChickenSandwich(message);
			else if (commandText.includes("sandwiches")) return this.commandHowManyChickenSandwiches(message);

		} else if (commandText.includes("lewd")) return this.commandLewd(message);
	}

	private async commandLewd (message: Message) {
		this.reply(message, randomOf(
			"please do not lewd the wayward loli.",
			"eek!",
			"did i give permission to do that?",
			"i'm so totally going to talk about you behind your back on tumblr, i feel so triggered right now",
			"so what if i like it.... baka!",
			"そごい",
			"それがすきです！",
			"rawr x3 nuzzles how are you *pounces on you* you're so warm o3o notices you have a bulge o: someone's happy ;) nuzzles your necky wecky~ murr~ hehehe rubbies your bulgy wolgy you're so big :oooo rubbies more on your bulgy wolgy it doesn't stop growing .///. *kisses you and lickies your necky*",
			"THERE ARE CHILDREN HERE!!!",
			"you promised to only do that when we're alone!",
			"!!!",
			"l;askdfjasdfopiJASL;KDFJASO;DKFN",
			"OMFG",
			"nooo!",
			"yesss!!!!",
			"i cant believe uve done this",
			"oh"));
	}

	private async commandHowCloseToNextChickenSandwich (message: Message) {
		const trackedMember = this.regularsPlugin.getTrackedMember(message.member.id);
		const sandwichTalent = trackedMember.talent % 270000;
		const extra = this.getExtra(sandwichTalent);
		this.reply(message, `with ${sandwichTalent} talent, you are ${Math.floor(sandwichTalent / 270000 * 100)}% of the way to a chicken sandwich. ${extra}`);
		return;
	}

	private async commandHowManyChickenSandwiches (message: Message) {
		const trackedMember = this.regularsPlugin.getTrackedMember(message.member.id);
		if (trackedMember.talent < 270000) {
			this.reply(message, "you don't have enough talent for any chicken sandwiches...");
			return;
		}

		const sandwichCount = Math.floor(trackedMember.talent / 270000);
		this.reply(message, `you have enough talent for ${sandwichCount} chicken sandwich${sandwichCount === 1 ? "" : "es"}.`);
		return;
	}

	private getExtra (talent: number) {
		if (Math.random() < 0.2) return "";

		if (Math.random() < 0.5) return randomOf(
			`i bet you wish you had ${270000 - talent} more talent right about now`,
			"sorry, only really talented people get chicken sandwiches",
			"this takes forever, doesn't it?",
			"it costs 270000 talent because i like watching you suffer",
			"don't worry, i'm watching you. i'm reading every message you send. you'll get there one day.",
			";)",
			"you must be hungry. well, don't worry, you only need to send another fifty thousand messages or so. be careful not to send them too fast though, or else i'll be forced to eat up your talent ;)",
			"( ͡° ͜ʖ ͡°)",
			"one day~",
			"annoying, right?",
			"a chicken sandwich from mcdonalds costs $1. a chicken sandwich also costs 270000 talent. that means 270000 talent is worth the same as $1, or that a talent is worth less than .0004 cents ;)",
			"hehehe",
			"do you think it'll ever happen?");

		if (talent < 5000) return randomOf(
			"lolnoob",
			"you have a long way to go my dude",
			"there are those like me, whose talent is so vast and incredible that their taste for chicken sandwiches can't be satiated by the entirety of the human race... and then there's those like you, who are so talentless that getting a chicken sandwich is basically a pipe dream. you should give up and leave it to those who aren't talentless blobs of meat",
			"hahhahahahahhahaahhahahhaahahahha",
			"it's gonna be a while",
			"if you stick around long enough maybe one day you'll have enough talent~");

		if (talent > 269000) return randomOf(
			"omfg you're so close dude",
			"you have sent so many god damn messages",
			"it would be a shame if something were to happen to all this talent",
			"i know you're getting excited, but please don't keep bugging me about chicken sandwiches",
			"can you taste the chicken sandwich yet?",
			"is your mouth watering?",
			"i wish i could get a chicken sandwich... my talent is limitless, after all. i suppose if i did get a chicken sandwich for every 270000 talent i had, society would collapse under the pressure of providing infinite chicken sandwiches to me. maybe that would be a bad idea. idk. i can still dream tho right");

		return "";
	}
}

function randomOf<T> (...choices: T[]) {
	return choices[Math.floor(Math.random() * choices.length)];
}
