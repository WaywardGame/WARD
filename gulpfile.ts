import Task, { remove, Pipe } from "./gulp/Task";
import TypescriptWatch from "./gulp/TypescriptWatch";
import mocha = require("gulp-mocha");

////////////////////////////////////
// Tasks
//

new Task("watch", remove("out"))
	.then("compile-test", async () => new TypescriptWatch("src", "out")
		.onComplete(Task.get("mocha"))
		.watch()
		.waitForInitial())
	.create();

Task.create("mocha", Pipe.create("out/tests/Main.js", { read: false })
	.pipe(() => mocha({ reporter: "min" }))
	.on("error", () => process.exitCode = 1));

Task.create("default", "watch");
