import type { Bundle } from "../types.js";
/** What `path` is, by asking the file system about it: reading a folder as a file fails differently on each system. */
export declare function kind(path: string): Promise<"folder" | "file" | undefined>;
export declare const isObject: (value: unknown) => value is Record<string, unknown>;
export declare const isStrings: (value: unknown) => value is string[];
export declare function readJson(path: string, where: string): Promise<unknown>;
/** Refuses a file that is not a Bundle-shaped object whose entries are objects, before anything reads inside it. */
export declare function checkBundle(value: unknown, where: string): Bundle;
