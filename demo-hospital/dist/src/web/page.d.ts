/** The world's date the page last set for the worker at `scriptUrl`, an instant, or undefined when none is set. */
export declare function worldDate(scriptUrl: string | URL): Promise<string | undefined>;
/**
 * Sets the world's date, an instant, for the worker at `scriptUrl`, or with undefined removes it so every hospital
 * answers with every version it holds. The date is kept in Cache Storage, where the worker finds it again after it
 * was stopped; resolves once the worker has dropped the hospitals it answered with, so the next request is as of the
 * new date. Rejects, saying why and leaving the kept date as it was, when the worker is not running.
 */
export declare function setWorldDate(scriptUrl: string | URL, asOf: string | undefined): Promise<void>;
/**
 * Registers the demo hospitals' worker at `scriptUrl`, with its folder as its scope, and resolves once it controls
 * the page, so the page's `fetch` reaches the demo hospitals. Rejects, saying why, when it cannot.
 */
export declare function useDemoHospitals(scriptUrl: string | URL): Promise<void>;
