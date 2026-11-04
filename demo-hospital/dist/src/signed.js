const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function base64url(bytes) {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
function fromBase64url(text) {
    if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) {
        return undefined;
    }
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
export async function sha256(text) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
    return base64url(new Uint8Array(digest));
}
export class Signer {
    #secret;
    #imported;
    constructor(secret) {
        this.#secret = secret;
    }
    get #key() {
        this.#imported ??= crypto.subtle.importKey("raw", encoder.encode(this.#secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
        return this.#imported;
    }
    async sign(note) {
        const body = base64url(encoder.encode(JSON.stringify(note)));
        const mac = await crypto.subtle.sign("HMAC", await this.#key, encoder.encode(body));
        return `${body}.${base64url(new Uint8Array(mac))}`;
    }
    async verify(signed) {
        const parts = signed.split(".");
        if (parts.length !== 2)
            return undefined;
        const [body, mac] = parts;
        const macBytes = fromBase64url(mac);
        const bodyBytes = fromBase64url(body);
        if (!macBytes || !bodyBytes)
            return undefined;
        const valid = await crypto.subtle.verify("HMAC", await this.#key, macBytes, encoder.encode(body));
        if (!valid)
            return undefined;
        try {
            const note = JSON.parse(decoder.decode(bodyBytes));
            return typeof note === "object" && note !== null && !Array.isArray(note)
                ? note
                : undefined;
        }
        catch {
            return undefined;
        }
    }
}
//# sourceMappingURL=signed.js.map