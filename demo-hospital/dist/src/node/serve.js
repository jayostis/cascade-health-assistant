import { createServer, } from "node:http";
import { isIP } from "node:net";
import { demoRouter } from "../index.js";
import { HospitalDataError, isInstant } from "../history.js";
import { DEMO_HOSTS } from "../hosts.js";
import { hospitalId } from "../route.js";
const WORLD_DATE = "/world-date";
const SIGN_IN_PAGE = /^\/[^/]+\/authorize\/?$/;
function headersOf(headers) {
    const out = {};
    for (const [name, value] of headers)
        if (name !== "set-cookie")
            out[name] = value;
    const cookies = headers.getSetCookie();
    if (cookies.length > 0)
        out["set-cookie"] = cookies;
    return out;
}
/** Writes `response` to `outgoing`, each `Set-Cookie` as a header of its own. */
export async function send(outgoing, response) {
    const payload = Buffer.from(await response.arrayBuffer());
    outgoing.writeHead(response.status, headersOf(response.headers));
    outgoing.end(payload);
}
function plain(status, words, headers = {}) {
    return new Response(words, {
        status,
        headers: { "Content-Type": "text/plain", ...headers },
    });
}
/** The host and proto of the first element of a `Forwarded` header (RFC 7239), each undefined when it names none. */
function forwardedHostAndProto(header) {
    const found = {};
    for (const pair of (header.split(",")[0] ?? "").split(";")) {
        const [name, value] = pair.trim().split("=");
        const key = name?.toLowerCase();
        if ((key === "host" || key === "proto") && value)
            found[key] = value.replace(/^"|"$/g, "").toLowerCase();
    }
    return found;
}
/** `http://<host>`, undefined when `host` is not a host and an optional port. */
function originOf(host) {
    try {
        const at = new URL(`http://${host}`);
        return at.host === host.toLowerCase() ? at.origin : undefined;
    }
    catch {
        return undefined;
    }
}
const ALWAYS_ALLOWED = new Set(["localhost", "host.docker.internal"]);
/** `host`'s name when it is not an IP literal, `localhost`, `host.docker.internal` or one of `named`; undefined when it is one, or not a host. */
function refusedName(host, named) {
    const origin = originOf(host);
    if (origin === undefined)
        return undefined;
    const { hostname } = new URL(origin);
    return isIP(hostname.replace(/^\[|\]$/g, "")) !== 0 ||
        ALWAYS_ALLOWED.has(hostname) ||
        named.has(hostname)
        ? undefined
        : hostname;
}
/** Whether a browser marked the request as sent from a page other than the listener's own. */
function crossSite(incoming) {
    const { origin, host } = incoming.headers;
    const site = incoming.headers["sec-fetch-site"];
    return ((origin !== undefined &&
        (host === undefined || origin !== originOf(host))) ||
        (site !== undefined && site !== "same-origin" && site !== "none"));
}
/**
 * The URL the client asked, undefined when the target is not an origin-form path or a header does not fit it. With
 * `Forwarded`, `https://<id>.demo.invalid/<rest>` from `/<id>/<rest>`. Without, a sign-in page is the listener's own,
 * `<origin>/<id>/authorize`; any other path is the one asked of the `Host` the client named, as `http://<host>/<path>`.
 */
function asked(origin, target, forwarded, host) {
    if (!target.startsWith("/") || /^.[/\\]/.test(target))
        return undefined;
    const url = new URL(origin + target);
    if (forwarded === undefined) {
        if (host === undefined || SIGN_IN_PAGE.test(url.pathname))
            return url;
        const named = originOf(host);
        return named === undefined ? undefined : new URL(named + target);
    }
    const [, id, ...rest] = url.pathname.split("/");
    const { host: forwardedHost, proto } = forwardedHostAndProto(forwarded);
    if (proto !== undefined && proto !== "https")
        return undefined;
    if (!id || forwardedHost?.replace(/:443$/, "") !== `${id}${DEMO_HOSTS}`)
        return undefined;
    return new URL(`https://${id}${DEMO_HOSTS}/${rest.join("/")}${url.search}`);
}
function checkedAsOf(asOf) {
    if (asOf !== undefined && !isInstant(asOf))
        throw new HospitalDataError("asOf", "asOf is an instant, as 2024-02-01T00:00:00Z");
}
/**
 * Serves `hospitals` on `127.0.0.1`, at `port` or one the system picks. A client that reaches them through
 * `demoRemapFetch(origin)` gets each hospital at the address it holds, `https://<id>.demo.invalid/...`, so every link in
 * its records names that address; its sign-in pages are the listener's own, `<origin>/<id>/authorize`. A client that
 * calls the listener directly gets each hospital at `http://<host>/<id>/fhir`, where `<host>` is the one it asked,
 * and every link names that. A request whose `Host` names anything but an IP literal, `localhost`,
 * `host.docker.internal` or one of `hosts` is a 403. `POST <origin>/world-date` with the form field `asOf` moves the
 * world's date; one a browser sends from another page is a 403.
 */
export async function serveDemo(hospitals, options = {}) {
    checkedAsOf(options.asOf);
    const named = new Set([...(options.hosts ?? [])].map((name) => name.toLowerCase()));
    const held = [...hospitals];
    let route;
    let origin = "";
    const routeAt = (asOf) => {
        checkedAsOf(asOf);
        const byId = new Map(held.map((each) => [hospitalId(each), { ...each, asOf }]));
        return demoRouter((id) => Promise.resolve(byId.get(id)), {
            authorizeBase: `${origin}/`,
            direct: true,
        });
    };
    async function body(incoming) {
        const chunks = [];
        for await (const chunk of incoming)
            chunks.push(chunk);
        return Buffer.concat(chunks);
    }
    async function worldDate(incoming) {
        if (crossSite(incoming))
            return plain(403, "The world's date is not moved by a page on another site.");
        if (incoming.method !== "POST")
            return plain(405, "The world's date is moved by a POST.", {
                Allow: "POST",
            });
        const asOf = new URLSearchParams((await body(incoming)).toString()).get("asOf");
        if (asOf === null || (asOf !== "" && !isInstant(asOf)))
            return plain(400, "The form field asOf is an instant, as 2024-02-01T00:00:00Z, or empty for every version.");
        route = routeAt(asOf === "" ? undefined : asOf);
        return plain(200, asOf === ""
            ? "The hospitals now answer with every record's latest version."
            : `The hospitals now answer as their records stood at ${asOf}.`);
    }
    async function answer(incoming, outgoing) {
        const forwarded = incoming.headers.forwarded;
        const target = incoming.url ?? "/";
        const { host } = incoming.headers;
        const refused = host === undefined ? undefined : refusedName(host, named);
        if (refused !== undefined) {
            await send(outgoing, plain(403, `The listener answers an IP address, localhost or host.docker.internal; start it with --host ${refused} to answer that name.`));
            return;
        }
        if (forwarded === undefined && target.split("?")[0] === WORLD_DATE) {
            await send(outgoing, await worldDate(incoming));
            return;
        }
        let url;
        try {
            url = asked(origin, target, forwarded, incoming.headers.host);
        }
        catch {
            url = undefined;
        }
        let response;
        if (url === undefined || route === undefined)
            response = plain(400, "The target must be a path; with Forwarded, it must name https and the host <id>.demo.invalid of the hospital in the path, and without, Host must name a host.");
        else {
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers))
                if (name !== "forwarded" &&
                    name !== "host" &&
                    typeof value === "string")
                    headers.set(name, value);
            const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
            const request = new Request(url, {
                method: incoming.method,
                headers,
                body: hasBody ? await body(incoming) : undefined,
                redirect: "manual",
            });
            options.onRequest?.(request);
            response = await route(request);
        }
        await send(outgoing, response);
    }
    const server = createServer((incoming, outgoing) => {
        answer(incoming, outgoing).catch(() => {
            if (outgoing.headersSent)
                outgoing.destroy();
            else
                outgoing.writeHead(500).end();
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    route = routeAt(options.asOf);
    return {
        origin,
        setWorldDate(asOf) {
            route = routeAt(asOf);
        },
        close: () => new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
        }),
    };
}
//# sourceMappingURL=serve.js.map