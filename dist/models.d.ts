export declare const MODELS_FILE_NAME = "models.json";
export declare const MODELS_SCAFFOLD: string;
export declare function modelsFilePath(env?: NodeJS.ProcessEnv): string;
export declare function piModelsFilePath(env?: NodeJS.ProcessEnv): string;
export declare function ensureModelsFile(env?: NodeJS.ProcessEnv): Promise<string>;
