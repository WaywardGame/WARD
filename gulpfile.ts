import Task, { Pipe, remove } from "./gulp/Task";
import TypescriptWatch from "./gulp/TypescriptWatch";
import mocha = require("gulp-mocha");

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
