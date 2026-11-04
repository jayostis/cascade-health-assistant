import type { Bundle, Resource } from "./types.js";
/** What a shorthand entry says of its record: when it began, and when it stopped. */
export interface Shorthand {
    active?: string;
    stopped?: string;
}
export interface ShorthandEntry {
    fullUrl?: string;
    resource?: Resource;
    shorthand?: Shorthand;
}
/** An authoring file: a `collection` whose entries may carry `shorthand` beside `resource`. */
export interface ShorthandBundle {
    resourceType: "Bundle";
    type: string;
    entry?: ShorthandEntry[];
}
/** Whether a patient file's entry carries `shorthand`, so the file is an authoring file to compile. */
export declare function hasShorthand(bundle: Bundle | ShorthandBundle): boolean;
/**
 * Compiles an authoring file to the history Bundle a hospital serves. An entry with no `shorthand` is placed at its
 * clinical date (a Patient, at the file's earliest record time), as one version. A `MedicationStatement` or a
 * `Condition` with `shorthand.stopped` becomes two: active from `shorthand.active` (or its clinical date), then
 * completed or resolved on the day it stopped. Throws HospitalDataError where the dates cannot say it.
 */
export declare function compileShorthand(file: ShorthandBundle, where: string): Bundle;
