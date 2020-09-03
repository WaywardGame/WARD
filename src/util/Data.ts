import { Api } from "../core/Api";
import type { Plugin } from "../core/Plugin";
import { EventEmitterAsync } from "./Async";
import Bound from "./Bound";
import FileSystem from "./FileSystem";
import Logger from "./Log";
import { minutes } from "./Time";
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
		plugin.data.event.subscribe("save", this.tryMakeBackup);
		return plugin.data.load();
	}

	@Bound
	private async tryMakeBackup () {
		const now = Date.now();
		if (now - this.lastBackupTime < minutes(10))
			return;

		this.lastBackupTime = now;

		const backups = await FileSystem.readDir(this.dirBackups);
		const lastBackup = backups.sort().last();
		const today = new Date().toISOString().slice(0, 10);
		const dirBackup = `${this.dirBackups}/${today}/${this.guild}`;
		// Logger.verbose("Data", "Last backup:", lastBackup, "Today:", today);
		if (lastBackup === today)
			return;

		const backupAlreadyExists = await FileSystem.exists(dirBackup);
		if (backupAlreadyExists)
			Logger.verbose("Data", "Backup already exists, skipping creation");

		else await this.makeBackup(dirBackup)
			.catch(err => Logger.error("Data", "Unable to make backup", err));
	}

	private async makeBackup (dir: string) {
		await FileSystem.mkdir(dir);
		await FileSystem.copy(this.dirData, dir);
		Logger.info("Data", "Backup made! Directory:", dir);
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

	public get data () {
		return this._data;
	}

	public constructor (private readonly api: Data, private readonly host: IDataContainerHost<DATA>) { }

	public isDirty () {
		if (this.dirty)
			return true;

		const newDataJson = JSON.stringify(this._data);
		return this.dirty = newDataJson !== this.dataJson;
	}

	public async load () {
		if (!await FileSystem.exists(this.getPath())) {
			this._data = this.host.initData();
			return;
		}

		const dataJson = await FileSystem.readFile(this.getPath(), "utf8");
		this._data = json5.parse(dataJson);
		this.dataJson = JSON.stringify(this._data);
	}

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

	public async saveOpportunity () {
		if (this.isDirty() || Date.now() - this._lastSave > this.host.autosaveInterval)
			return this.save();
	}

	private getPath () {
		return `${this.api.dirData}/${this.host.dataPath}.json`;
	}
}
