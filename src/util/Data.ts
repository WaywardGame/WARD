import { Api } from "../core/Api";
import type { Plugin } from "../core/Plugin";
import { EventEmitterAsync } from "./Async";
import Bound from "./Bound";
import FileSystem from "./FileSystem";
import Logger from "./Log";
import Strings from "./Strings";
import { getISODate, minutes } from "./Time";
import json5 = require("json5");

export interface IDataConfig {
	dir?: string;
}

export default class Data extends Api<IDataConfig> {
	public readonly dirData: string;
	public readonly dirBackups = "data/backups";
	public readonly dirExternalData: string;
	private lastBackupTime = 0;

	public constructor (private readonly guild: string) {
		super();
		this.dirData = `data/${guild}`;
		this.dirExternalData = `data/${guild}/external`;
	}

	public getDefaultId () {
		return "data";
	}

	public async init () {
		await FileSystem.mkdir(this.dirData);
		await FileSystem.mkdir(this.dirBackups);
		await FileSystem.mkdir(this.dirExternalData);

		await this.tryMakeBackup();
	}

	public createContainer<DATA extends {}> (host: IDataContainerHost<DATA>) {
		const container = new DataContainer(this, host);
		const proxy = new Proxy(container, {
			get (target, prop) {
				return target[prop as keyof typeof target] ?? target.data?.[prop as keyof DATA];
			},
		}) as FullDataContainer<DATA>;
		(container.event as any).host = proxy;
		return proxy;
	}

	public async load (plugin: Plugin) {
		plugin.data.event.subscribe("save", () => this.tryMakeBackup());
		return plugin.data.load();
	}

	public async backup () {
		return this.tryMakeBackup(true);
	}

	@Bound
	private async tryMakeBackup (forced = false) {
		const now = Date.now();
		if (now - this.lastBackupTime < minutes(10) && !forced)
			return false;

		this.lastBackupTime = now;

		const today = getISODate();
		let backupAlreadyExists = true;
		let dirBackup: string;
		for (const uniqueExtension of Strings.unique()) {
			dirBackup = `${this.dirBackups}/${today}${forced ? uniqueExtension : ""}/${this.guild}`;

			backupAlreadyExists = await FileSystem.exists(dirBackup);
			if (!backupAlreadyExists || !forced)
				break;

			// the backup already exists and this backup is forced.
			// when forcing an additional backup, generate a new unique extension repeatedly until finding one that hasn't been used yet
			continue;
		}

		if (!backupAlreadyExists)
			return await this.makeBackup(dirBackup!)
				.catch(err => {
					Logger.error("Data", "Unable to make backup", err)
					return false;
				});

		Logger.verbose("Data", "Backup already exists, skipping creation");
		return false;
	}

	private async makeBackup (dir: string) {
		await FileSystem.mkdir(dir);
		await FileSystem.copy(this.dirData, dir);
		Logger.info("Data", "Backup made! Directory:", dir);
		return true;
	}
}

export type FullDataContainer<DATA extends {} = any> = DataContainer<DATA> & { [K in keyof DATA]: DATA[K] };

export interface IDataContainerHost<DATA extends {} = any> {
	autosaveInterval: number;
	dataPath: string;
	initData (): DATA;
}

export class DataContainer<DATA extends {} = any> {

	public event = new EventEmitterAsync(this);

	private _data?: DATA;
	private dataJson?: string;
	private dirty = false;
	private _lastSave = 0;
	private saving?: Promise<void>;

	public get lastSaveTime () { return this._lastSave; }
	public get timeSinceLastSave () { return Date.now() - this._lastSave; }
	public get timeTillNextSave () { return Math.max(0, this.host.autosaveInterval - this.timeSinceLastSave); }

	public get data () {
		return this._data;
	}

	public constructor (private readonly api: Data, private readonly host: IDataContainerHost<DATA>) { }

	@Bound
	public isDirty () {
		if (this.dirty)
			return true;

		// only recalculate with JSON.stringify every ten minutes
		if (this.timeSinceLastSave < minutes(10))
			return false;

		const newDataJson = JSON.stringify(this._data);
		this.dirty = newDataJson !== this.dataJson;

		// fake an autosave so that it'll be another 10 minutes till the next
		if (!this.dirty)
			this._lastSave = Date.now();

		return this.dirty;
	}

	@Bound
	public markDirty () {
		this.dirty = true;
	}

	@Bound
	public async load () {
		if (!await FileSystem.exists(this.getPath())) {
			this.reset();
			return;
		}

		const dataJson = await FileSystem.readFile(this.getPath(), "utf8");
		this._data = json5.parse(dataJson);
		this.dataJson = JSON.stringify(this._data);
	}

	@Bound
	public async save () {
		return this.saving ?? (this.saving = new Promise<void>(async resolve => {
			this._lastSave = Date.now();
			this.dataJson = JSON.stringify(this._data);
			await FileSystem.writeFile(this.getPath(), this.dataJson);
			await this.event.emit("save");
			resolve();
			this._lastSave = Date.now();
			this.dirty = false;
			delete this.saving;
		}));

	}

	@Bound
	public async saveOpportunity () {
		if (this.isDirty() || this.timeSinceLastSave > this.host.autosaveInterval)
			return this.save();
	}

	public reset () {
		this._data = this.host.initData();
		this.markDirty();
	}

	private getPath () {
		return `${this.api.dirData}/${this.host.dataPath}.json`;
	}
}
