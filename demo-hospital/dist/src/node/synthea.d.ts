import type { Bundle, Hospital, Resource } from "../index.js";
import { type Person } from "./people.js";
/** Who is chosen from the run, as `synthea/people.json` lists them. */
export interface Chosen {
    person: string;
    synthea: string;
    hospitals: string[];
}
/** The run `synthea/README.md` gives, as a generated person records it. */
export declare const RUN: {
    by: string;
    seed: number;
    clinicianSeed: number;
    referenceDate: string;
    endDate: string;
    arguments: string;
};
/** A generated person's `person.json`, from the Patient of their first hospital's file. */
export declare function generatedPerson(chosen: Chosen, first: Bundle): Person;
export declare const OBSERVATION_CATEGORIES: string[];
/** One row of Synthea's `csv/medications.csv`, the only place an order's stop is dated. */
export interface MedicationRow {
    start: string;
    stop: string;
    encounter: string;
    code: string;
}
export interface HospitalFolder {
    folder: string;
    hospital: Hospital;
}
export interface PatientFile {
    folder: string;
    id: string;
    bundle: Bundle;
}
export interface Removed {
    names: string[];
    addresses: string[];
    telecoms: string[];
}
export declare function syntheaId(folder: string, synthea: string): string;
export declare function withoutDigits(text: string): string;
/** A person's rows. The first six columns hold no quotes or commas. */
export declare function medicationRows(csv: string, patient: string): MedicationRow[];
export declare function bundleText(bundle: Bundle): string;
export declare function providerDetails(providers: Resource[]): Removed;
export declare function fromSynthea(bundle: Bundle, hospitals: HospitalFolder[], medications: MedicationRow[]): PatientFile[];
