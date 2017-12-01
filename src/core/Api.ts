import { Importable } from "./Importable";

export abstract class Api<Config = {}> extends Importable<Config> {
}

export const metadataKeyImport = Symbol("import");
export function ImportApi (toImport: string) {
	return Reflect.metadata(metadataKeyImport, toImport);
}
