import type { Bundle, Hospital } from "./types.js";
/**
 * A patient's records as they stood at `asOf` (their latest versions when absent) as a `collection` whose `fullUrl`s
 * are the hospital's own, so a file of it reads as the records a pull of that hospital would have brought. Throws
 * HospitalDataError for a patient the hospital does not hold (at `asOf`, a Patient record present and not deleted),
 * and for an `asOf` that is not an instant.
 */
export declare function exportCollection(hospital: {
    hospital: Hospital;
    patients: Record<string, Bundle>;
}, patient: string, asOf?: string): Bundle;
