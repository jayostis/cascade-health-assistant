import type { Hospital, Resource } from "./types.js";
/**
 * A name's words, lower-cased, without accents and in alphabetical order, so a pod's name (`rowan-ellery-marsh`) and
 * a patient's (`Marsh`, `Rowan Ellery`) are the same whichever way round they are written.
 */
export declare function nameWords(name: string): string;
export declare function namesOf(patient: Resource | undefined, id: string): {
    family: string;
    given: string;
};
export declare const SIMULATED_ERRORS: {
    readonly token_invalid_token: "The token request is refused: invalid client";
    readonly token_invalid_scope: "The token request is refused: invalid scope";
    readonly request_invalid_token: "Every record request is refused: invalid token";
    readonly request_expired_token: "Every record request is refused: token expired";
};
export type SimulatedError = keyof typeof SIMULATED_ERRORS;
export declare function simulatedError(name: string | null | undefined): SimulatedError | undefined;
/** An instant's UTC day in words: `1 February 2024`. */
export declare function inWords(instant: string): string;
export declare function escape(text: string): string;
export declare function scopeInWords(scope: string): string | undefined;
export declare function page(hospital: Hospital, body: string): string;
