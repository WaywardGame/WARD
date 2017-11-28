import { Plugin } from "./Plugin";
export declare class Ward {
    private plugins;
    private stopped;
    private onStop;
    start(): Promise<void>;
    stop(): Promise<{}>;
    update(): void;
    addPlugin(plugin: Plugin): string;
    removePlugin(pid: string): void;
}
