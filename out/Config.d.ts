export interface IConfig {
    discord: {
        username: string;
        token: string;
    };
    trello: {
        board: string;
        key: string;
    };
}
export declare class Config {
    private onGetHandlers;
    private result;
    private isGetting;
    get(): Promise<any>;
}
declare const config: Config;
export default config;
