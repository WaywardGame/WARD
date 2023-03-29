import * as env from "dotenv";
import * as fs from "fs";
import Task, { Pipe, remove } from "./gulp/Task";
import TypescriptWatch from "./gulp/TypescriptWatch";
import { nameFunction } from "./gulp/Util";
import mocha = require("gulp-mocha");

fs.appendFileSync(".env", "");
env.config();

////////////////////////////////////
// Tasks
//

Task.create("mocha", Pipe.create("out/tests/Main.js", { read: false })
	.pipe(() => mocha({ reporter: "even-more-min" }))
	.on("error", () => process.exitCode = 1));

new Task("compile-test", remove("out"))
	.then("compile", async () => new TypescriptWatch("src", "out").once())
	.then("mocha")
	.create();

new Task("watch", remove("out"))
	.then("compile-test", async () => new TypescriptWatch("src", "out")
		.onComplete(Task.get("mocha"))
		.watch()
		.waitForInitial())
	.create();

Task.create("default", "watch");

new Task("deploy", nameFunction("remove WARD_DEPLOY_PATH", async () => {
	if (!process.env.WARD_DEPLOY_PATH)
		throw new Error("Cannot deploy, WARD_DEPLOY_PATH not set");
	return del(process.env.WARD_DEPLOY_PATH, { force: true });
}))
	.then("copy", Pipe.create("out/**/*").pipe(process.env.WARD_DEPLOY_PATH!))
	.create();
