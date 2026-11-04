import type { Bundle, BundleEntry, Resource } from "./types.js";
export declare class HospitalDataError extends Error {
    readonly where: string;
    readonly reason: string;
    constructor(where: string, reason: string);
}
export interface RecordVersion {
    /** `<type>/<id>`. */
    readonly record: string;
    /** `"1"` for a plain record with no `meta.versionId`. */
    readonly versionId: string;
    /** The record time; absent for a plain record. */
    readonly recorded?: string;
    /** Absent for a deletion. */
    readonly resource?: Resource;
}
/** Whether `text` is a FHIR `instant`: a time to the second, with a timezone. */
export declare function isInstant(text: unknown): text is string;
/** Each record's versions in a patient file, oldest first, checked by the file's rules; throws HospitalDataError. */
export declare function versionsOf(bundle: Bundle, where: string): ReadonlyMap<string, readonly RecordVersion[]>;
/** A version's record time in milliseconds; a plain record's one version is earlier than every time. */
export declare function time(version: RecordVersion): number;
/** The versions of a record whose record time is at or before `asOf` (every version when it is absent), oldest first. */
export declare function versionsUpTo(versions: readonly RecordVersion[], asOf?: string): readonly RecordVersion[];
/**
 * Each patient's records, by patient id, from a hospital's patient files: each file checked by `versionsOf`, its
 * `fullUrl`s against the hospital's FHIR base, the Patient it holds against its name, and no record in two files. A
 * refusal names the patient's file as `places` gives it, else `patient <id>`.
 */
export declare function patientRecords(fhirBase: string, patients: Record<string, Bundle>, places?: Readonly<Record<string, string>>): Map<string, ReadonlyMap<string, readonly RecordVersion[]>>;
/** The resources present at `asOf` (every latest version when absent), each as its version then. */
export declare function recordsAt(bundle: Bundle, asOf?: string): Resource[];
/** The period a FHIR date or dateTime names at its precision, in milliseconds, its end excluded: `2024` is the whole year. */
export declare function periodOf(text: string): {
    start: number;
    end: number;
} | undefined;
/**
 * A version of a record as a history entry: the one writer of the etag form `W/"<versionId>"`, which `versionsOf`
 * checks. Version `1` is the creating POST, any other a PUT; `recorded` is both the entry's `lastModified` and the
 * resource's `meta.lastUpdated`.
 */
export declare function historyEntry(resource: Resource, versionId: string, recorded: string, fullUrl?: string): BundleEntry;
