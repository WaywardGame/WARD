import del, { Options } from "del";
import * as Gulp from "gulp";
import { Task as UndertakerTask } from "undertaker";
import { nameFunction, sleep, stringifyCall } from "./Util";
import * as Vinyl from "vinyl-fs";

export type Tasks = (UndertakerTask | Series | Pipe)[];

export type Done = () => void;

export class Series {
	public static parallel (...parallel: Tasks) {
		return Gulp.parallel(parallel.map(Series.getTask));
	}

	private static getTask (task: UndertakerTask | Series | Pipe) {
		return task instanceof Series ? task.get() : task instanceof Pipe ? task.get() : task;
	}

	protected readonly series: UndertakerTask[] = [];
	public constructor (...parallel: Tasks) {
		this.then("", ...parallel);
	}

	public then (name: string, ...parallel: Tasks) {
		let fn;
		if (parallel.length > 1) fn = Series.parallel(...parallel);
		else if (parallel.length === 0) fn = name, name = "";
		else fn = Series.getTask(parallel[0]);

		if (name && typeof fn === "function") nameFunction(name, fn as AnyFunction);

		this.series.push(fn);
		return this;
	}

	protected get () {
		return this.series.length === 1 ? this.series[0] : Gulp.series(...this.series);
	}
}

export default class Task extends Series {
	public static create (name: string, ...parallel: Tasks) {
		return new Task(name, ...parallel).create();
	}

	public static get (name: string) {
		return Gulp.task(name);
	}

	private created = false;
	private readonly name: string;

	public constructor (name: string, ...parallel: Tasks) {
		super(...parallel);
		this.name = name;

		sleep(1000).then(() => {
			if (!this.created) {
				throw new Error("Task was named but not created.");
			}
		});
	}

	public create () {
		const task = this.get();
		Gulp.task(this.name, typeof task === "string" ? Gulp.task(task) : task);
		this.created = true;
	}
}

type AnyFunction = (...args: any[]) => any;

export class Pipe {
	public static create (src: Gulp.Globs, opts?: Vinyl.SrcOptions) {
		return new Pipe("", src, opts);
	}

	private pipes: (() => NodeJS.ReadWriteStream)[] = [];
	private readonly name: string;
	private readonly src: Gulp.Globs;
	private readonly opts?: Vinyl.SrcOptions;
	private readonly eventHandlers = {
		error: [] as AnyFunction[],
	};

	public constructor (name: string, src: Gulp.Globs, opts?: Vinyl.SrcOptions) {
		this.name = name;
		this.src = src;
		this.opts = opts;
	}

	public pipe (pipe: (() => NodeJS.ReadWriteStream) | string) {
		this.pipes.push(typeof pipe === "string" ? () => Gulp.dest(pipe) : pipe);
		return this;
	}

	public on (event: "error", handler: AnyFunction) {
		this.eventHandlers[event].push(handler);
		return this;
	}

	public get () {
		return nameFunction(this.name, () => {
			let stream = Gulp.src(this.src, this.opts);
			for (const pipe of this.pipes) {
				stream = stream.pipe(pipe());
			}

			for (const handler of this.eventHandlers.error) {
				stream.on("error", handler);
			}

			return stream;
		});
	}
}

export function watch (watches: Gulp.Globs, ...parallel: Tasks) {
	return nameFunction(stringifyCall("watch", watches), async () => {
		Gulp.watch(watches, Series.parallel(...parallel));
	});
}

export function remove (toRemove: Gulp.Globs, options?: Options) {
	return nameFunction(stringifyCall("remove", toRemove), () => del(toRemove, options));
}

export function symlink (path: string) {
	return () => Gulp.symlink(path);
}
