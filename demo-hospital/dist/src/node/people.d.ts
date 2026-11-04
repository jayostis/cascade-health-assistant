import type { Bundle, Resource } from "../types.js";
export type Gender = "male" | "female" | "other" | "unknown";
export interface PersonName {
    family: string;
    given: string[];
}
type Field = "name" | "birthDate" | "gender";
type Grade = "certain" | "probable" | "possible" | "certainly-not";
/** A deliberate disagreement of one source with its person, and the match grade a matcher is expected to give it. */
export interface Difference {
    source: string;
    field: Field;
    value: PersonName | string;
    reason: string;
    expectedMatch: Grade;
}
/** How a generated person was made: written by `npm run synthea`, never by hand. */
export interface Generated {
    by: string;
    syntheaId: string;
    seed: number;
    clinicianSeed: number;
    referenceDate: string;
    endDate: string;
    arguments: string;
    hospitals: string[];
}
/** A person's `person.json`: who they are, the one place their name, birth date, gender and pod subject live. */
export interface Person {
    id: string;
    name: PersonName;
    birthDate: string;
    gender: Gender;
    subject?: {
        iri: string;
        name: string;
        storage: string;
    };
    kit?: string;
    differences?: Difference[];
    generated?: Generated;
}
export interface LoadedPerson {
    /** The person's folder, an absolute path. */
    folder: string;
    person: Person;
    /** Each FHIR source's Bundle, by the source's folder name. */
    sources: Record<string, Bundle>;
    /** The sources that hold C-CDA documents, by folder name: their differences are the vocabulary's to check. */
    documents: string[];
}
export declare const isName: (value: unknown) => value is PersonName;
/** Refuses a `person.json` without the fields every person has, or whose id is not its folder's name. */
export declare function checkPerson(value: unknown, folder: string): Person;
/** The id of the one Patient a source holds; refuses a source holding none or more. */
export declare function patientOf(bundle: Bundle, where: string): string;
/** A Patient's name entry with `use` `official`, else its first, or undefined where it has none. */
export declare function officialName(patient: Resource): PersonName | undefined;
/**
 * Compares every version of each source's Patient with the person on name, birth date and gender; a field a Patient
 * omits is not compared. Refuses a disagreement the person does not declare. A declared difference must show in its
 * source where that source is a `fhir.json` alone; one at a source among `documents` (C-CDA, which this loader does not
 * read) or, for a kit person, at a source with no folder (a kit download) is the vocabulary's to check. A difference at
 * a source the person has nowhere is refused.
 */
export declare function checkIdentity(person: Person, sources: Record<string, Bundle>, documents?: readonly string[]): void;
/**
 * Every person in the folders given, in the order of their ids: each folder of a root that holds people, identity-checked.
 * A root that is not a folder is skipped, and so is a file at a root's top level, and a name with a leading dot. One id in
 * two roots throws.
 */
export declare function loadPeople(roots: readonly string[]): Promise<LoadedPerson[]>;
export {};
