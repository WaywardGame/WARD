export abstract class Importable<Config = {}> {
	public config: Config;

	private id = this.getDefaultId();

	public abstract getDefaultId (): string;
	public getId () {
		return this.id;
	}
	public setId (pid: string) {
		this.id = pid;
	}
}
