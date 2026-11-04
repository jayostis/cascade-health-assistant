/**
 * A `fetch` that sends a request for `https://<id>.demo.invalid/<rest>` to a listener at `origin`
 * (`http://127.0.0.1:<port>`), as `<origin>/<id>/<rest>` with the `Forwarded` header that names the address the
 * client asked; every other request goes to `fallback`. A caller that asks to follow redirects (fetch's default)
 * has them followed here, through the remap, up to twenty as `fetch` does; `"manual"` passes a redirect through.
 */
export declare function demoRemapFetch(origin: string, fallback?: typeof fetch): typeof fetch;
