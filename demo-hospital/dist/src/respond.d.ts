export declare const NO_STORE: {
    "Cache-Control": string;
    Pragma: string;
};
export declare const PREFLIGHT: {
    "Access-Control-Allow-Origin": string;
    "Access-Control-Allow-Methods": string;
    "Access-Control-Allow-Headers": string;
};
export declare function html(status: number, body: string): Response;
export declare function json(status: number, headers: Record<string, string>, body: unknown): Response;
export declare function fhirJson(status: number, body: unknown, headers?: Record<string, string>): Response;
export declare function tokenError(error: string, status?: number, description?: string): Response;
export declare function notAllowed(allow: string): Response;
export declare function outcome(status: number, code: fhir4.OperationOutcomeIssue["code"], diagnostics: string, headers?: Record<string, string>): Response;
