import { Plugin } from "../Plugin";
export declare class ChangelogPlugin extends Plugin {
    private id;
    getId(): string;
    setId(pid: string): void;
    update(): Promise<void>;
}
