import { type ServerResponse } from "node:http";
import { type DemoHospitalOptions } from "../index.js";
export interface DemoListener {
    /** Where it listens, `http://127.0.0.1:<port>`; hand it to `demoRemapFetch`, or call `<origin>/<id>/fhir` directly. */
    readonly origin: string;
    /** Moves the world's date: the next request answers as of `asOf`, an instant, or with every version when undefined. */
    setWorldDate(asOf: string | undefined): void;
    close(): Promise<void>;
}
/** Writes `response` to `outgoing`, each `Set-Cookie` as a header of its own. */
export declare function send(outgoing: ServerResponse, response: Response): Promise<void>;
/**
 * Serves `hospitals` on `127.0.0.1`, at `port` or one the system picks. A client that reaches them through
 * `demoRemapFetch(origin)` gets each hospital at the address it holds, `https://<id>.demo.invalid/...`, so every link in
 * its records names that address; its sign-in pages are the listener's own, `<origin>/<id>/authorize`. A client that
 * calls the listener directly gets each hospital at `http://<host>/<id>/fhir`, where `<host>` is the one it asked,
 * and every link names that. A request whose `Host` names anything but an IP literal, `localhost`,
 * `host.docker.internal` or one of `hosts` is a 403. `POST <origin>/world-date` with the form field `asOf` moves the
 * world's date; one a browser sends from another page is a 403.
 */
export declare function serveDemo(hospitals: Iterable<DemoHospitalOptions>, options?: {
    readonly asOf?: string;
    /** The port to listen on; absent or 0, the system picks one. */
    readonly port?: number;
    /** Names besides IP literals, `localhost` and `host.docker.internal` that a request's `Host` may give. */
    readonly hosts?: Iterable<string>;
    /** Called with each request as it is handed to the hospitals. */
    readonly onRequest?: (request: Request) => void;
}): Promise<DemoListener>;
