
import { GuildMember, Message, MessageEmbed, User } from "discord.js";
import { Command, CommandMessage, CommandResult, IField } from "../core/Api";
import HelpContainerPlugin from "../core/Help";
import { Paginator } from "../core/Paginatable";
import { IInherentPluginData, Plugin } from "../core/Plugin";
import { COLOR_BAD, COLOR_GOOD, COLOR_WARNING } from "../util/Colors";
import Strings from "../util/Strings";
import { days, getTime, minutes, renderTime } from "../util/Time";

enum CommandLanguage {
	RemindAfterDescription = "Adds a reminder to be sent a single time, after the given amount of time has passed.",
	RemindEveryDescription = "Adds a reminder to be sent repeatedly, using the given amount of time as an interval between reminders.",
	RemindArgumentTime = "The time to wait for this reminder. Ex: `30m`, `1h`, `2d`",
	RemindArgumentReminder = "The text of the reminder.",
	ReminderRemovePreviousDescription = "Removes the most recent reminder. Not sure which one it was? It'll confirm it with you before removing anything.",
	ReminderRemoveNextDescription = "Removes the next reminder. Not sure which one it is? It'll confirm it with you before removing anything.",
	RemindersDescription = "Lists all upcoming reminders.",
	DowntimeQueryDescription = "Reminders are delayed until after \"downtime\" ends. This command displays the current downtime configuration, whether it's active, and when it will toggle on or off.",
	DowntimeSetDescription = "Configures the start or end of downtime. Note that downtime will not function until both the start and end have been configured.",
	DowntimeSetArgumentStartEnd = "Whether to configure the start or the end of downtime.",
	DowntimeSetArgumentTime = "When to set the downtime to start or end.",
	DowntimeSetArgumentAgo = "Whether to set the downtime to start or end this amount of time *ago*.",
	DowntimeRemoveDescription = "Removes the configured downtime.",
}

export interface IReminder {
	message: string;
	time: number;
	type: "after" | "every";
	last: number;
	owner: string;
}

export interface IDowntime {
	start?: number;
	end?: number;
}

export interface IReminderPluginData extends IInherentPluginData {
	reminders: IReminder[];
	downtime: Record<string, IDowntime>;
}

export class RemindersPlugin extends Plugin<{}, IReminderPluginData> {

	public readonly updateInterval = minutes(1);

	protected readonly initData: () => IReminderPluginData = () => ({ reminders: [], downtime: {} });

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
				const downtime = this.data.downtime[reminder.owner];
				const { active } = getDowntimeInfo(downtime);
				if (active)
					continue;

				reminder.last = Date.now();
				let remove = reminder.type === "after";

				const reminderOwner = this.guild.members.cache.get(reminder.owner);
				if (reminderOwner) {
					reminderOwner.send(new MessageEmbed()
						.setTitle(Strings.trailing(255, Strings.sentence(`Reminder: ${Strings.sentence(reminder.message)}!`)))
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
		.addCommand("reminders", CommandLanguage.RemindersDescription)
		.addCommand("reminder downtime", CommandLanguage.DowntimeQueryDescription)
		.addCommand("reminder downtime", CommandLanguage.DowntimeSetDescription, command => command
			.addRawTextArgument("start|end", CommandLanguage.DowntimeSetArgumentStartEnd)
			.addArgument("time", CommandLanguage.DowntimeSetArgumentTime)
			.addRawTextArgument("ago", CommandLanguage.DowntimeSetArgumentAgo, argument => argument
				.setOptional()))
		.addCommand("reminder downtime remove", CommandLanguage.DowntimeRemoveDescription);

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
			.setColor(COLOR_GOOD)
			.setTitle(Strings.trailing(255, Strings.sentence(`Added reminder: ${Strings.sentence(reminderMessage)}!`)))
			.setDescription(reminderMessage.length > 255 - 17 ? Strings.sentence(`${reminderMessage}!`) : undefined)
			.setFooter(type === "after" ? `This reminder will be sent once, after ${renderTime(time)}.`
				: `This reminder will be sent every ${renderTime(time)}.`));
		return CommandResult.pass();
	}

	@Command("reminder remove")
	protected async onReminderRemove (message: CommandMessage, ...query: string[]) {
		const reminders = this.getReminders(message)
			.map((reminder, i) => ({ data: reminder, id: i }));

		const matchingReminders = Strings.searchOnKey(query, reminders, "message");
		if (!matchingReminders)
			return this.reply(message, "No matching reminders found to remove.")
				.then(reply => CommandResult.fail(message, reply));

		const { page } = await Paginator.create(matchingReminders, ({ data: reminder }) => new MessageEmbed()
			.setTitle(Strings.trailing(255, Strings.sentence(`${reminder.message}!`)))
			.setDescription(reminder.message.length > 255 ? Strings.sentence(`${reminder.message}!`) : undefined)
			.setFooter(reminder.type === "after" ? `Will be sent ${renderTime(getTimeTill(reminder), { lowest: "second", zero: "any moment now", prefix: "in " })}.`
				: `Currently sent every ${renderTime(reminder.time)}.`))
			.addOption("🗑", "Remove this reminder")
			.replyAndAwaitReaction(message, reaction => reaction.name === "🗑");

		if (!page)
			return this.reply(message, "No reminders were removed.")
				.then(() => CommandResult.pass());

		return this.removeReminder(message, page.originalValue.data);
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
			.setColor(COLOR_WARNING)
			.setAuthor("Are you sure you want to remove this reminder?")
			.setTitle(Strings.trailing(255, Strings.sentence(`${Strings.sentence(reminder.message)}!`)))
			.setDescription(reminder.message.length > 254 ? Strings.sentence(`${reminder.message}!`) : undefined)
			.setFooter(reminder.type === "after" ? `This reminder's only occurrence, ${renderTime(getTimeTill(reminder), { lowest: "second", zero: "any moment now", prefix: "in " })}, will be skipped.`
				: `This reminder will no longer be sent every ${renderTime(reminder.time)}.`))
			.reply(message);

		if (!remove)
			return message.reply("No reminders were removed.")
				.then(reply => CommandResult.pass(message, reply));

		const index = this.data.reminders.indexOf(reminder);
		if (index !== -1) {
			this.data.reminders.splice(index, 1);
			this.data.markDirty();
		}

		this.logger.info(`${this.getName(message)} removed a reminder for ${reminder.type} ${renderTime(reminder.time)}`);
		this.reply(message, new MessageEmbed()
			.setColor(COLOR_BAD)
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
			.setPageDescription(getDowntimeInfo(this.data.downtime[message.author.id]).active ? "(Reminders may be delayed by downtime.)" : undefined)
			.reply(message);

		return CommandResult.pass();
	}

	private getReminders (author: GuildMember | User | Message) {
		return this.data.reminders
			.filter(isOwnedBy(author));
	}

	private getRecentReminders (author: GuildMember | User | Message) {
		return this.getReminders(author)
			.sort(({ last: lastA }, { last: lastB }) => lastB - lastA);
	}

	private getUpcomingReminders (author: GuildMember | User | Message) {
		const now = Date.now();
		return this.getReminders(author)
			.sort((reminderA, reminderB) => getTimeTill(reminderA, now) - getTimeTill(reminderB, now))
	}

	@Command("reminder downtime remove")
	protected onDowntimeRemove (message: CommandMessage) {
		delete this.data.downtime[message.author.id];

		this.reply(message, new MessageEmbed()
			.setTitle("A downtime is not currently configured.")
			.setDescription(`All reminders will be sent as normal.`));

		return CommandResult.pass();
	}

	@Command("reminder downtime")
	protected onDowntime (message: CommandMessage, configStr?: string, timeStr?: string, agoStr?: string) {
		const config = configStr as "start" | "end" | undefined;
		let downtime = this.data.downtime[message.author.id];

		const now = Date.now() % days(1);
		if (config) {
			if (!downtime)
				downtime = this.data.downtime[message.author.id] = {};

			const offset = getTime(timeStr) * (agoStr === "ago" ? -1 : 1);
			this.data.downtime[message.author.id][config] = (Date.now() + offset) % days(1);
			this.data.markDirty();
		}

		if (!downtime) {
			this.reply(message, new MessageEmbed()
				.setTitle("A downtime is not currently configured.")
				.setDescription(`Use \`${this.commandPrefix}reminder downtime start\` and \`${this.commandPrefix}reminder downtime end\` to set the start and end times!\n\nNote that the downtime feature will *not* function until both the start and end are set.`));
			return CommandResult.pass();
		}

		const { active, partial } = getDowntimeInfo(downtime, now);
		this.reply(message, new MessageEmbed()
			.setColor(active ? "7e42f5" : partial ? "f5ce42" : "7ad1ff")
			.setTitle(active ? "Downtime is active." : partial ? `A downtime is ${partial ? "partially " : ""}configured.` : "Downtime is not active.")
			.setDescription(`${active ? "Any scheduled reminders won't be displayed until downtime ends." : "All reminders will be sent as normal."}\n\nUse \`${this.commandPrefix}reminder downtime start\` and \`${this.commandPrefix}reminder downtime end\` to set the start and end time!${partial ? "\n\nNote that the downtime feature will *not* function until both the start and end are set." : ""}\n\nUse \`${this.commandPrefix}reminder downtime remove\` to remove the downtime.`)
			.addField("Start", downtime.start === undefined ? "not configured" : renderTimeComparison(downtime.start!, now, !active))
			.addField("End", downtime.end === undefined ? "not configured" : renderTimeComparison(downtime.end!, now, active)));

		return CommandResult.pass();
	}
}

function getDowntimeInfo (downtime?: IDowntime, now = Date.now()) {
	if (!downtime)
		return { partial: false, active: false };

	now %= days(1);
	const partial = (downtime.start === undefined) !== (downtime.end === undefined);
	return {
		partial,
		active: !partial && isTimeInRange(downtime.start!, downtime.end!, now),
	};
}

function renderTimeComparison (time: number, compare: number, future: boolean) {
	if (future) {
		if (time < compare)
			time += days(1);

		return renderTime(time - compare, { prefix: "in ", zero: "at any moment" });
	}

	if (compare < time)
		compare += days(1);

	return renderTime(compare - time, { suffix: " ago", zero: "just now" });
}

function getTimeTill (reminder: IReminder, now = Date.now()) {
	return reminder.time - (now - reminder.last);
}

function isOwnedBy (author: GuildMember | User | Message) {
	author = author instanceof Message ? author.author : author;
	return ({ owner }: IReminder) => owner === author.id;
}

function isTimeInRange (start: number, end: number, time: number) {
	if (start > end)
		return time > start || time < end;

	return time > start && time < end;
}
