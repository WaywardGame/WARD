import Strings from "../util/Strings";
import Paginatable, { Paginator } from "./Paginatable";

export default class HelpContainerPlugin implements Paginatable<[string]> {

	private commands: [string, HelpContainerCommand][] = [];
	private description?: string;
	private filter?: (text: string) => string;

	public setDescription (description: string) {
		this.description = description;
		return this;
	}

	public addCommand (name: string, description: string, initializer?: (container: HelpContainerCommand) => any) {
		const container = new HelpContainerCommand(name, description);
		initializer?.(container);
		this.commands.push([name, container]);
		return this;
	}

	public setTextFilter (filter: (text: string) => string) {
		this.filter = filter;
		return this;
	}

	public getPaginator (commandPrefix: string) {
		return Paginator.create([["", this.description], ...this.commands], ([command, container]) => {
			const text = typeof container === "string" ? container
				: container?.getDisplay(commandPrefix)
					.replace(/\t/g, "\u200b \u200b \u200b \u200b ");

			return (text && this.filter?.(text)) ?? text;
		});
	}
}

export class HelpContainerCommand {
	private arguments: HelpContainerArgument[] = [];

	public constructor (private readonly name: string, private readonly description: string) {
	}

	public addRawTextArgument (rawText: string, defaultOptionDescription?: string): this;
	public addRawTextArgument (defaultOption: string, defaultOptionDescription: string | undefined, initializer: (container: HelpContainerArgumentRaw) => any): this;
	public addRawTextArgument (defaultOption: string, defaultOptionDescription?: string, initializer?: (container: HelpContainerArgumentRaw) => any) {
		const container = new HelpContainerArgumentRaw(defaultOption, defaultOptionDescription);
		initializer?.(container);
		this.arguments.push(container);
		return this;
	}

	public addArgument (name: string, description: string, initializer?: (container: HelpContainerArgumentBasic) => any) {
		const container = new HelpContainerArgumentBasic(name, description);
		initializer?.(container);
		this.arguments.push(container);
		return this;
	}

	public addRemainingArguments (name: string, description: string) {
		this.arguments.push(new HelpContainerArgumentsRemaining(name, description));
		return this;
	}

	public getDisplay (commandPrefix: string) {
		const argumentsText = this.arguments.map(argument => argument.getDisplay()).join(" ");
		return [
			`\`${commandPrefix}${this.name}${argumentsText ? ` ${argumentsText}` : ""}\``,
			`${this.description}`,
			...!this.arguments.length ? [] :
				["\n" + Strings.indent(this.arguments
					.filter(argument => argument.shouldGiveHelp())
					.map(argument => `◇ \`${argument.getDisplay()}\` — ${argument.getDescription()}`)
					.join("\n\n"))],
		].join("\n");
	}
}

export abstract class HelpContainerArgument {
	public abstract getDisplay (): string;
	public shouldGiveHelp () { return true; }
	public abstract getDescription (): string;
}

export class HelpContainerArgumentBasic extends HelpContainerArgument {

	private optional = false;
	private defaultValue?: any;

	public constructor (private readonly name: string, private readonly description: string) {
		super();
	}

	public setOptional () {
		this.optional = true;
		return this;
	}

	public setDefaultValue (defaultValue: any) {
		this.defaultValue = defaultValue;
		return this;
	}

	public getDisplay () {
		return `<${this.name}${this.defaultValue !== undefined ? `=${this.defaultValue}` : this.optional ? "?" : ""}>`;
	}

	public getDescription () {
		const defaultValueText = this.defaultValue !== undefined ? `. Defaults to **${this.defaultValue}**` : "";
		const optionalText = this.optional || defaultValueText ? `_Optional${defaultValueText}_. ` : "";
		return `${optionalText}${this.description}`;
	}
}

export class HelpContainerArgumentsRemaining extends HelpContainerArgument {

	public constructor (private readonly name: string, private readonly description: string) {
		super();
	}

	public getDisplay () {
		return `<...${this.name}>`;
	}

	public getDescription () {
		return this.description;
	}
}

export class HelpContainerArgumentRaw extends HelpContainerArgument {

	private readonly defaultOption: [string, string?];
	private readonly options: [string, string?][] = [];
	private optional = false;

	public constructor (defaultOption: string, defaultOptionDescription?: string) {
		super();
		this.defaultOption = [defaultOption, defaultOptionDescription];
	}

	public addOption (option: string, description?: string) {
		this.options.push([option, description]);
		return this;
	}

	public addOptions (...options: ArrayOrReadonlyArray<[option: string, description: string]>) {
		this.options.push(...options);
		return this;
	}

	public setOptional () {
		this.optional = true;
		return this;
	}

	public getDisplay () {
		const optional = this.optional ? "?" : "";
		return this.options.length > 4 ? `<${this.defaultOption[0]}${optional}>`
			: this.options.length === 0 ? this.defaultOption[0] + optional
				: this.options
					.map(([option]) => option)
					.join("|")
				+ optional;
	}

	public shouldGiveHelp () {
		const options = this.options.length === 0 ? [this.defaultOption] : this.options;
		return options.some(([, description]) => description);
	}

	public getDescription () {
		const optional = this.optional ? `_Optional_. ` : "";
		return this.options.length === 0 ? this.defaultOption[1] || ""
			: `${optional}Any of:\n${this.options
				.map(([option, description]) => Strings.indent(`- \`${option}\`${description ? ` — ${description}` : ""}`))
				.join("\n")}`;
	}
}
