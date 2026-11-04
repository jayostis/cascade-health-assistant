import type { Bundle, Hospital } from "./index.js";
/**
 * The hospitals as a SMART User-access Brands Bundle: per hospital an Organization and its Endpoint, so a directory
 * of them is the standard document any app that reads one can read.
 */
export declare function brandsBundle(hospitals: readonly Hospital[], timestamp: string): Bundle & {
    timestamp: string;
    meta: Record<string, unknown>;
};
