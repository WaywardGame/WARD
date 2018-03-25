import { Importable } from "./Importable";

export abstract class Api<Config = {}> extends Importable<Config> {
}

export const metadataKeyImportApi = Symbol("import-api");
export function ImportApi (toImport: string) {
	return Reflect.metadata(metadataKeyImportApi, toImport);
}

export const metadataKeyImportPlugin = Symbol("import-plugin");
export function ImportPlugin (toImport: string) {
	return Reflect.metadata(metadataKeyImportPlugin, toImport);
}
