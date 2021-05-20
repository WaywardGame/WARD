export abstract class Importable<CONFIG extends object = {}> {
	public abstract get config (): Flatten<CONFIG>;
	public abstract setConfig (value: CONFIG): any;

	private id = this.getDefaultId();

	public abstract getDefaultId (): string;
	public getId () {
		return this.id;
	}
	public setId (pid: string) {
		this.id = pid;
	}
}
