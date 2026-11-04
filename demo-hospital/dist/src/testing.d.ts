import { type DemoHospitalOptions } from "./index.js";
import type { DemoHospital } from "./index.js";
/** A PKCE code verifier and its S256 challenge (RFC 7636). */
export declare function pkcePair(): {
    verifier: string;
    challenge: string;
};
/**
 * Answers a hospital's sign-in page as `patient`: fetches the page at `authorizeUrl`, posts its form with
 * `decision` (`allow` or `cancel`), and returns the callback URL the hospital redirects to.
 */
export declare function answerSignIn(fetch: typeof globalThis.fetch, authorizeUrl: string | URL, patient: string, decision?: string): Promise<URL>;
export interface SignedIn {
    token: string;
    /** The authorization code that was exchanged for it, now spent. */
    code: string;
}
export interface SignInOptions {
    /** The scope the client asks for; the default is a patient launch that reads everything. */
    scope?: string;
    /** The protocol clock of the hospital built to sign in; not allowed when signing in through a `fetch`. */
    now?: () => Date;
}
/**
 * Signs in as `patient` the way a client does: the hospital's discovery, its sign-in form posted with the patient
 * allowed, and the code exchanged with a fresh PKCE pair. Given a hospital's options it builds the hospital and
 * returns it beside the token; given a `fetch` and the hospital's `base`, it signs in through that.
 */
export declare function signInAs(hospital: DemoHospitalOptions, patient: string, options?: SignInOptions): Promise<SignedIn & {
    hospital: DemoHospital;
}>;
export declare function signInAs(through: {
    fetch: typeof globalThis.fetch;
    base: string;
}, patient: string, options?: Pick<SignInOptions, "scope">): Promise<SignedIn>;
