import { type DemoHospitalOptions } from "./index.js";
export interface RouteOptions {
    /**
     * Where the authorize pages are, ending in a slash: hospital `<id>`'s is `<authorizeBase><id>/authorize`. With
     * none, each is the hospital's own, `<fhirBase>/authorize`.
     */
    readonly authorizeBase?: string;
}
/** One hospital by its id, or undefined when there is none of that id. */
export type LoadHospital = (id: string) => Promise<DemoHospitalOptions | undefined>;
/** Whether a request is the demo hospitals', from its URL alone: a `*.demo.invalid` host, or a path under `authorizeBase`. */
export declare function isDemoRequest(url: URL | string, options?: RouteOptions): boolean;
export interface RouterOptions extends RouteOptions {
    /**
     * Also answer a request on any other origin whose path starts `/<id>/`, as hospital `<id>` at the base
     * `<origin>/<id><path>`, where `<path>` is its FHIR base's path: a listener's direct callers.
     */
    readonly direct?: boolean;
}
/**
 * Answers a request `isDemoRequest` claims, with the hospital it names, each loaded once on its first request. A
 * hospital that `load` does not know is a 404.
 */
export declare function demoRouter(load: LoadHospital, options?: RouterOptions): (request: Request) => Promise<Response>;
/** The id of a hospital, from its FHIR base's host. */
export declare function hospitalId(options: DemoHospitalOptions): string;
/** A `fetch` that sends the demo hospitals' requests to them, and every other to `fallback`. */
export declare function demoFetch(hospitals: Iterable<DemoHospitalOptions>, options?: RouteOptions & {
    readonly fallback?: typeof fetch;
}): typeof fetch;
