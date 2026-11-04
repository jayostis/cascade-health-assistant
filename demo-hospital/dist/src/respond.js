export const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
export const PREFLIGHT = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
};
const FHIR_JSON = "application/fhir+json";
export function html(status, body) {
    return new Response(body, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}
export function json(status, headers, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
}
export function fhirJson(status, body, headers = {}) {
    return json(status, { "Content-Type": FHIR_JSON, ...headers }, body);
}
export function tokenError(error, status = 400, description) {
    return json(status, NO_STORE, description === undefined
        ? { error }
        : { error, error_description: description });
}
export function notAllowed(allow) {
    return outcome(405, "not-supported", "This address does not take that method.", {
        Allow: allow,
    });
}
export function outcome(status, code, diagnostics, headers = {}) {
    const body = {
        resourceType: "OperationOutcome",
        issue: [
            {
                severity: "error",
                code,
                diagnostics,
            },
        ],
    };
    return fhirJson(status, body, headers);
}
//# sourceMappingURL=respond.js.map