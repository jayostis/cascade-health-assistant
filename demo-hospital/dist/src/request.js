export function parseUrl(text) {
    if (!text)
        return undefined;
    try {
        return new URL(text);
    }
    catch {
        return undefined;
    }
}
export function positive(text) {
    const value = Number(text);
    return text !== null && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}
export function pagePosition(offset) {
    return btoa(`at:${offset}`).replace(/=+$/, "");
}
export function position(page) {
    try {
        const match = /^at:(\d+)$/.exec(atob(page));
        return match ? Number(match[1]) : undefined;
    }
    catch {
        return undefined;
    }
}
export function categories(resource) {
    const category = resource.category;
    if (!Array.isArray(category))
        return [];
    return category.flatMap((concept) => concept.coding ?? []);
}
export function token(text) {
    const bar = text.indexOf("|");
    return bar === -1
        ? { code: text }
        : { system: text.slice(0, bar), code: text.slice(bar + 1) };
}
/** The letters of `cruds` that a token's scopes grant on `type`. */
export function granted(scopes, type) {
    const letters = new Set();
    for (const scope of scopes.split(" ")) {
        const match = /^patient\/(\*|[A-Za-z]+)\.(read|write|\*|c?r?u?d?s?)$/.exec(scope);
        if (!match || (match[1] !== "*" && match[1] !== type))
            continue;
        const asked = match[2] ?? "";
        const given = asked === "read"
            ? "rs"
            : asked === "write"
                ? "cud"
                : asked === "*"
                    ? "cruds"
                    : asked;
        for (const letter of given)
            letters.add(letter);
    }
    return [...letters].join("");
}
export function patientId(reference, base) {
    for (const prefix of [`${base}/Patient/`, "Patient/"]) {
        if (reference?.startsWith(prefix))
            return reference.slice(prefix.length);
    }
    return reference;
}
//# sourceMappingURL=request.js.map