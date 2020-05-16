import * as fs2 from "fs-extra-p";
import * as fs from "mz/fs";

module FileSystem {
	export const readFile = fs.readFile;
	export const writeFile = fs.writeFile;
	export const readDir = fs.readdir;
	export const exists = fs.exists;
	export const mkdir = fs2.mkdirp;
	export const copy = fs2.copy;
}

export default FileSystem;
