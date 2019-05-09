import { Plugin } from "./Plugin";

export interface ExternalPluginEntryPoint {
	initialize (cls: typeof ExternalPlugin): ExternalPlugin;
}

export default abstract class ExternalPlugin extends Plugin {
	protected getDataPath () {
		return `data/${this.guild.id}/external/${this.getId()}.json`;
	}
}