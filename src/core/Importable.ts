export abstract class Importable<Config = {}> {
	public abstract get config (): Config;
	public abstract set config (value: Config);

	private id = this.getDefaultId();

	public abstract getDefaultId (): string;
	public getId () {
		return this.id;
	}
	public setId (pid: string) {
		this.id = pid;
	}
}
