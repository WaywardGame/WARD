import { Plugin } from "./Plugin";

export interface ExternalPluginEntryPoint {
	default?(cls: typeof ExternalPlugin): Class<ExternalPlugin, ConstructorParameters<typeof ExternalPlugin>>;
}

export default abstract class ExternalPlugin<CONFIG extends {} = {}, DATA = {}> extends Plugin<CONFIG, DATA> {
	protected getDataPath () {
		return `data/${this.guild.id}/external/${this.getId()}.json`;
	}
}