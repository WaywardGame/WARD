
import { GuildMember, Message, MessageEmbed, User } from "discord.js";
import { Command, CommandMessage, CommandResult, IField } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Paginator } from "../core/Paginatable";
import { Plugin } from "../core/Plugin";
import Strings from "../util/Strings";
import { getTime, minutes, renderTime } from "../util/Time";

enum CommandLanguage {
	RemindAfterDescription = "Adds a reminder to be sent a single time, after the given amount of time has passed.",
	RemindEveryDescription = "Adds a reminder to be sent repeatedly, using the given amount of time as an interval between reminders.",
	RemindArgumentTime = "The time to wait for this reminder. Ex: `30m`, `1h`, `2d`",
	RemindArgumentReminder = "The text of the reminder.",
	ReminderRemovePreviousDescription = "Removes the most recent reminder. Not sure which one it was? It'll confirm it with you before removing anything.",
	ReminderRemoveNextDescription = "Removes the next reminder. Not sure which one it is? It'll confirm it with you before removing anything.",
	RemindersDescription = "Lists all upcoming reminders.",
}

export interface IReminder {
	message: string;
	time: number;
	type: "after" | "every";
	last: number;
	owner: string;
}

export interface IReminderPluginData {
	reminders: IReminder[];
}

export class RemindersPlugin extends Plugin<{}, IReminderPluginData> {

	public readonly updateInterval = minutes(1);

	protected readonly initData = () => ({ reminders: [] });

	public getDefaultConfig () {
		return {};
	}

	public getDefaultId () {
		return "reminders";
	}

	public getDescription () {
		return "A plugin for configuring and managing scheduled reminders from the bot. (Sent, and generally configured, via DMs)";
	}

	public async onUpdate () {
		const reminders = this.data.reminders;
		for (let i = 0; i < reminders.length; i++) {
			const reminder = reminders[i];
			if (Date.now() - reminder.last > reminder.time) {
				reminder.last = Date.now();
				let remove = reminder.type === "after";

				const reminderOwner = this.guild.members.cache.get(reminder.owner);
				if (reminderOwner) {
					reminderOwner.send(new MessageEmbed()
						.setTitle(Strings.trailing(255, Strings.sentence(`Reminder: ${reminder.message}!`)))
						.setDescription(reminder.message.length > 254 ? Strings.sentence(`${reminder.message}!`) : undefined)
						.setFooter(reminder.type === "after" ? "This reminder will not be sent again."
							: `This reminder will be sent again after ${renderTime(reminder.time)}.`));
					this.logger.info(`Sent a reminder to ${reminderOwner.displayName}`);

				} else
					this.logger.warning("Could not find a user for reminder, removing");

				if (remove || !reminderOwner)
					reminders.splice(i--, 1);

				this.data.markDirty();
			}
		}
	}

	private readonly help = () => new HelpContainerPlugin()
		.addCommand("remind after", CommandLanguage.RemindAfterDescription, command => command
			.addArgument("time", CommandLanguage.RemindArgumentTime)
			.addRemainingArguments("reminder", CommandLanguage.RemindArgumentReminder))
		.addCommand("remind every", CommandLanguage.RemindEveryDescription, command => command
			.addArgument("time", CommandLanguage.RemindArgumentTime)
			.addRemainingArguments("reminder", CommandLanguage.RemindArgumentReminder))
		.addCommand("reminder remove previous|last", CommandLanguage.ReminderRemovePreviousDescription)
		.addCommand("reminder remove next", CommandLanguage.ReminderRemoveNextDescription)
		.addCommand("reminders", CommandLanguage.RemindersDescription);

	@Command(["help reminders", "reminders help"])
	protected async commandHelp (message: CommandMessage) {
		this.reply(message, this.help());
		return CommandResult.pass();
	}

	@Command("remind")
	protected async onRemind (message: CommandMessage, type: string, timeString: string, ...reminder: string[]) {
		if (type !== "after" && type !== "every")
			return message.reply(`Unknown reminder type "${type}"`)
				.then(reply => CommandResult.fail(message, reply));

		const time = getTime(timeString);
		const reminderMessage = reminder.join(" ");
		this.data.reminders.push({
			message: reminderMessage,
			time,
			type,
			last: Date.now(),
			owner: message.author.id,
		});
		this.data.markDirty();

		this.logger.info(`${this.getName(message)} added a reminder for ${type} ${renderTime(time)}`);
		this.reply(message, new MessageEmbed()
			.setColor("00FF00")
			.setTitle(Strings.trailing(255, Strings.sentence(`Added reminder: ${Strings.sentence(reminderMessage)}!`)))
			.setDescription(reminderMessage.length > 255 - 17 ? Strings.sentence(`${reminderMessage}!`) : undefined)
			.setFooter(type === "after" ? `This reminder will be sent once, after ${renderTime(time)}.`
				: `This reminder will be sent every ${renderTime(time)}.`));
		return CommandResult.pass();
	}

	@Command(["reminder remove last", "reminder remove previous"])
	protected async onReminderRemovePrevious (message: CommandMessage) {
		return this.removeReminder(message, this.getRecentReminders(message)[0]);
	}

	@Command(["reminder remove next"])
	protected async onReminderRemoveNext (message: CommandMessage) {
		return this.removeReminder(message, this.getUpcomingReminders(message)[0]);
	}

	private async removeReminder (message: CommandMessage, reminder: IReminder) {
		if (!reminder)
			return message.reply("There are no reminders to remove.")
				.then(reply => CommandResult.fail(message, reply));

		const remove = await this.yesOrNo("", new MessageEmbed()
			.setColor("FF8800")
			.setAuthor("Are you sure you want to remove this reminder?")
			.setTitle(Strings.trailing(255, Strings.sentence(`${Strings.sentence(reminder.message)}!`)))
			.setDescription(reminder.message.length > 254 ? Strings.sentence(`${reminder.message}!`) : undefined)
			.setFooter(reminder.type === "after" ? `This reminder's only occurrence, ${renderTime(getTimeTill(reminder), { lowest: "second", zero: "any moment now", prefix: "in " })}, will be skipped.`
				: `This reminder will no longer be sent every ${renderTime(reminder.time)}.`))
			.reply(message);

		if (!remove)
			return CommandResult.pass();

		const index = this.data.reminders.indexOf(reminder);
		if (index !== -1) {
			this.data.reminders.splice(index, 1);
			this.data.markDirty();
		}

		this.logger.info(`${this.getName(message)} removed a reminder for ${reminder.type} ${renderTime(reminder.time)}`);
		this.reply(message, new MessageEmbed()
			.setColor("FF0000")
			.setTitle(Strings.trailing(255, Strings.sentence(`Removed reminder: ${Strings.sentence(reminder.message)}!`)))
			.setDescription(reminder.message.length > 255 - 19 ? Strings.sentence(`${reminder.message}!`) : undefined)
			.setFooter(reminder.type === "after" ? `This reminder's only occurrence, ${renderTime(getTimeTill(reminder), { lowest: "second", zero: "any moment now", prefix: "in " })}, is skipped.`
				: `This reminder will no longer be sent every ${renderTime(reminder.time)}.`));
		return CommandResult.pass();
	}

	@Command("reminders")
	protected onReminders (message: CommandMessage) {
		const now = Date.now();
		const reminders = this.getUpcomingReminders(message)
			.map((reminder, i) => ({
				name: Strings.trailing(255, `${i + 1}. ${Strings.sentence(reminder.message)}`),
				value: `_${renderTime(getTimeTill(reminder, now), { lowest: "second", zero: "any moment now", prefix: "in " })} (${reminder.type === "after" ? "once" : `every ${renderTime(reminder.time)}`})_`,
			} as IField));

		Paginator.create(reminders)
			.setPageHeader("Upcoming reminders")
			.reply(message);

		return CommandResult.pass();
	}

	private getRecentReminders (author: GuildMember | User | Message) {
		return this.data.reminders
			.filter(isOwnedBy(author))
			.sort(({ last: lastA }, { last: lastB }) => lastB - lastA);
	}

	private getUpcomingReminders (author: GuildMember | User | Message) {
		const now = Date.now();
		return this.data.reminders
			.filter(isOwnedBy(author))
			.sort((reminderA, reminderB) => getTimeTill(reminderA, now) - getTimeTill(reminderB, now))
	}

}

function getTimeTill (reminder: IReminder, now = Date.now()) {
	return reminder.time - (now - reminder.last);
}

function isOwnedBy (author: GuildMember | User | Message) {
	author = author instanceof Message ? author.author : author;
	return ({ owner }: IReminder) => owner === author.id;
}
