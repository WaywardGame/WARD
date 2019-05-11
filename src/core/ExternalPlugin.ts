import { Plugin } from "./Plugin";

export interface ExternalPluginEntryPoint {
	initialize (cls: typeof ExternalPlugin): ExternalPlugin;
}

export default abstract class ExternalPlugin<Config extends {} = {}, DataIndex extends string | number = string | number> extends Plugin<Config, DataIndex> {
	protected getDataPath () {
		return `data/${this.guild.id}/external/${this.getId()}.json`;
	}
}