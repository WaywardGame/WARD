import Data, { FullDataContainer } from "../util/Data";
import Logger from "../util/Log";
import Objects from "../util/Objects";
import { hours } from "../util/Time";

export interface IInherentImportableData<CONFIG extends {}> {
	_config?: Partial<Flatten<CONFIG>>;
}

export abstract class Importable<CONFIG extends object = {}, DATA extends IInherentImportableData<CONFIG> = IInherentImportableData<CONFIG>> {

	public readonly logger: Logger;

	public constructor (
		private readonly dataApi: Data,
		logger: Logger,
	) {
		this.logger = new Logger(...logger.scopes, this.getId());
	}

	////////////////////////////////////
	// ID
	//

	private id = this.getDefaultId();
	public abstract getDefaultId (): string;

	public getId () {
		return this.id;
	}
	public setId (pid: string) {
		this.id = pid;
	}

	////////////////////////////////////
	// Config
	//

	private _config: CONFIG;
	public get config (): Flatten<CONFIG> {
		return new Proxy({}, {
			get: (target, property) => {
				return this.getConfigValue(property as any);
			},
		}) as any;
	}

	protected getConfigValue<P extends keyof Flatten<CONFIG>> (property: P) {
		return this.data._config?.[property] ?? this.getConfigBaseValue(property);
	}
	protected getConfigBaseValue<P extends keyof Flatten<CONFIG>> (property: P): Flatten<CONFIG>[P] {
		return Objects.followKeys(this._config, property as any);
	}

	public setConfig (cfg: CONFIG) {
		this._config = cfg;
	}

	////////////////////////////////////
	// Data
	//

	public autosaveInterval = hours(2);

	private _data: FullDataContainer<DATA>;

	public get data () {
		if (!this._data)
			this._data = this.dataApi.createContainer<DATA>((self => ({
				get dataPath () { return self.getId(); },
				get autosaveInterval () { return self.autosaveInterval; },
				initData: () => ({ ...this.initData?.() } as any),
			}))(this))
				.event.subscribe("save", () => this.logger.verbose("Saved"))!;

		return this._data;
	};

	protected abstract initData: {} extends DATA ? (() => DATA) | undefined : () => DATA;
}
