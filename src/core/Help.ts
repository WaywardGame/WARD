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

	public addRawTextArgument (rawText: string): this;
	public addRawTextArgument (option0: string, option0Description: string | undefined, initializer: (container: HelpContainerArgumentRaw) => any): this;
	public addRawTextArgument (option0: string, option0Description?: string, initializer?: (container: HelpContainerArgumentRaw) => any) {
		const container = new HelpContainerArgumentRaw(option0, option0Description);
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

	private readonly options: [string, string?][] = [];

	public constructor (option0: string, option0Description?: string) {
		super();
		this.options.push([option0, option0Description]);
	}

	public addOption (option: string, description: string) {
		this.options.push([option, description]);
		return this;
	}

	public getDisplay () {
		return this.options
			.map(([option]) => option)
			.join("|");
	}

	public shouldGiveHelp () {
		return this.options.some(([, description]) => description);
	}

	public getDescription () {
		return `Any of:\n${this.options
			.map(([option, description]) => Strings.indent(`- \`${option}\`: ${description}`))
			.join("\n")}`;
	}
}
