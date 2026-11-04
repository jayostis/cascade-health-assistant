import { demoHospital, } from "./index.js";
import { DEMO_HOSTS } from "./hosts.js";
/** What a page's `fetch` may read of an answer from another origin, as a real server would expose them. */
const EXPOSED = "Retry-After, WWW-Authenticate, Location";
function parsed(url) {
    return typeof url === "string" ? new URL(url) : url;
}
/** The URL without its query or fragment. */
function address(url) {
    return `${url.origin}${url.pathname}`;
}
/** Whether a request is the demo hospitals', from its URL alone: a `*.demo.invalid` host, or a path under `authorizeBase`. */
export function isDemoRequest(url, options = {}) {
    const at = parsed(url);
    return (at.hostname.endsWith(DEMO_HOSTS) ||
        (options.authorizeBase !== undefined &&
            address(at).startsWith(options.authorizeBase)));
}
/**
 * The hospital a demo request is for: the host's first label, the folder under `authorizeBase`, or, for a direct
 * request, the path's first segment.
 */
function hospitalOf(url, options) {
    if (url.hostname.endsWith(DEMO_HOSTS)) {
        const id = url.hostname.slice(0, -DEMO_HOSTS.length);
        return id ? { id, direct: false } : undefined;
    }
    const { authorizeBase } = options;
    if (authorizeBase !== undefined && address(url).startsWith(authorizeBase)) {
        const [id, page, ...rest] = address(url)
            .slice(authorizeBase.length)
            .split("/");
        if (id && page === "authorize" && rest.length === 0)
            return { id, direct: false };
    }
    if (!options.direct)
        return undefined;
    const id = url.pathname.split("/")[1];
    return id ? { id, direct: true } : undefined;
}
function notFound(what) {
    return new Response(JSON.stringify({
        resourceType: "OperationOutcome",
        issue: [{ severity: "error", code: "not-found", diagnostics: what }],
    }), {
        status: 404,
        headers: {
            "Content-Type": "application/fhir+json",
            "Access-Control-Expose-Headers": EXPOSED,
        },
    });
}
function exposed(response) {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Expose-Headers", EXPOSED);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
/**
 * Answers a request `isDemoRequest` claims, with the hospital it names, each loaded once on its first request. A
 * hospital that `load` does not know is a 404.
 */
export function demoRouter(load, options = {}) {
    const hospitals = new Map();
    const hospital = (id) => {
        let found = hospitals.get(id);
        if (found === undefined) {
            found = load(id).then((loaded) => loaded && {
                answer: demoHospital({
                    ...loaded,
                    ...(options.authorizeBase === undefined
                        ? {}
                        : { authorizeUrl: `${options.authorizeBase}${id}/authorize` }),
                }),
                path: new URL(loaded.hospital.fhirBase).pathname.replace(/\/$/, ""),
            });
            hospitals.set(id, found);
            found.catch(() => hospitals.delete(id));
        }
        return found;
    };
    return async (request) => {
        const url = new URL(request.url);
        const of = hospitalOf(url, options);
        const held = of === undefined ? undefined : await hospital(of.id);
        if (of === undefined || held === undefined)
            return notFound(`There is no demo hospital at ${address(url)}.`);
        return exposed(await held.answer(request, of.direct ? `${url.origin}/${of.id}${held.path}` : undefined));
    };
}
/** The id of a hospital, from its FHIR base's host. */
export function hospitalId(options) {
    const host = new URL(options.hospital.fhirBase).hostname;
    if (!host.endsWith(DEMO_HOSTS))
        throw new Error(`${options.hospital.name}'s FHIR base is not on a ${DEMO_HOSTS.slice(1)} host`);
    return host.slice(0, -DEMO_HOSTS.length);
}
/** A `fetch` that sends the demo hospitals' requests to them, and every other to `fallback`. */
export function demoFetch(hospitals, options = {}) {
    const byId = new Map([...hospitals].map((each) => [hospitalId(each), each]));
    const route = demoRouter((id) => Promise.resolve(byId.get(id)), options);
    const fallback = options.fallback ?? globalThis.fetch.bind(globalThis);
    return (input, init) => isDemoRequest(input instanceof Request ? input.url : input, options)
        ? route(new Request(input, init))
        : fallback(input, init);
}
//# sourceMappingURL=route.js.map