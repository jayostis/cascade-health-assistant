import type { Resource } from "./types.js";
export declare function parseUrl(text: string | null): URL | undefined;
export declare function positive(text: string | null): number | undefined;
export declare function pagePosition(offset: number): string;
export declare function position(page: string): number | undefined;
interface Coding {
    system?: string;
    code?: string;
}
export declare function categories(resource: Resource): Coding[];
export declare function token(text: string): {
    system?: string;
    code: string;
};
/** The letters of `cruds` that a token's scopes grant on `type`. */
export declare function granted(scopes: string, type: string): string;
export declare function patientId(reference: string | null, base: string): string | null;
export {};
