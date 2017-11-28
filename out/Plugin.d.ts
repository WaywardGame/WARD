export declare abstract class Plugin {
    updateInterval: number;
    lastUpdate: number;
    private data;
    private loaded;
    abstract update(): any;
    abstract getId(): string;
    abstract setId(pid: string): void;
    save(): Promise<void>;
    protected setData(key: string, data: any): Promise<void>;
    protected getData(key: string): Promise<any>;
    private getDataPath();
}
