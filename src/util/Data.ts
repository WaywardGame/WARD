import { Api } from "../core/Api";
import type { Plugin } from "../core/Plugin";
import FileSystem from "./FileSystem";
import json5 = require("json5");

export interface IDataConfig {
	dir?: string;
}

export default class Data extends Api<IDataConfig> {
	private readonly dirData: string;
	private readonly dirBackups = "data/backups";
	private readonly dirExternalData: string;

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

		const backups = await FileSystem.readDir(this.dirBackups);
		const lastBackup = backups.sort().last();
		const today = new Date().toISOString().slice(0, 10);
		const dirBackup = `${this.dirBackups}/${today}/${this.guild}`;
		if (lastBackup !== today || !await FileSystem.exists(dirBackup))
			await this.makeBackup(dirBackup)
				.catch(err => console.error("Unable to make backup", err));
	}

	public async load (plugin: Plugin) {
		// console.log("load", plugin.getId());
		plugin.event.subscribe("save", () => this.save(plugin));

		const path = this.getPluginDataFile(plugin);
		if (!await FileSystem.exists(path))
			return {};

		return json5.parse(await FileSystem.readFile(path, "utf8"));
	}

	private async save (plugin: Plugin) {
		// console.log("request save", plugin.getId());

		let data = plugin["pluginData"];
		if (Object.keys(data).length === 0) {
			// console.log("cancel save", plugin.getId());
			return;
		}

		// console.log("actually save save", plugin.getId());
		data = {
			...data,
			_lastUpdate: plugin.lastUpdate,
		};

		// console.log(this.getPluginDataFile(plugin), data);

		await FileSystem.writeFile(this.getPluginDataFile(plugin), JSON.stringify(data));
	}

	private async makeBackup (dir: string) {
		await FileSystem.mkdir(dir);
		await FileSystem.copy(this.dirData, dir);
	}

	private getPluginDataFile (plugin: Plugin) {
		return `${this.dirData}/${plugin.getId()}.json`;
	}
}