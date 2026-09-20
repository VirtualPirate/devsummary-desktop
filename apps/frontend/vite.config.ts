import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import path from 'path';
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * The renderer's Content-Security-Policy, injected as a meta tag at build time.
 *
 * A meta tag rather than `onHeadersReceived` in the Electron main process: the
 * packaged app is loaded from disk with `win.loadFile`, and `file://` requests
 * carry no response headers for the webRequest hook to add one to. The meta tag
 * is the only slot a `file://` document has.
 *
 * Build-only (`apply: "build"`), because the dev server needs its own websocket
 * for HMR and React Refresh injects inline script that changes every reload.
 * Shipping a policy loose enough for both would undo the point of having one.
 *
 * What this is actually defending: a commit message, a diff and an LLM's answer
 * all reach the DOM, and the window holds the loopback API token.
 */
function contentSecurityPolicy(html: string): string {
  // Inline <script> is hashed, never `'unsafe-inline'`. There is exactly one —
  // the theme bootstrap in index.html, which has to run before first paint — and
  // hashing it here means it stays covered when its contents change, while any
  // *second* inline script has to be added deliberately rather than inherited.
  const inlineScripts = [
    ...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi),
  ].map(
    (match) =>
      `'sha256-${createHash("sha256").update(match[1] ?? "").digest("base64")}'`,
  )

  return [
    "default-src 'none'",
    // `file:` alongside `'self'`: a file:// document has an opaque origin, which
    // `'self'` serializes to "null" and matches nothing — the bundle would not
    // load at all. Same reason on every other directive that names a local file.
    `script-src 'self' file: ${inlineScripts.join(" ")}`.trimEnd(),
    // Tailwind v4 and Radix both inject <style> elements and style attributes at
    // runtime; there is no hash to pin for those.
    "style-src 'self' file: 'unsafe-inline'",
    // GitHub avatars on the collaborator pickers; `data:` for inlined assets.
    "img-src 'self' file: data: https://avatars.githubusercontent.com",
    "font-src 'self' file: data:",
    // The backend binds an OS-assigned free port every launch, so the port is a
    // wildcard and the loopback host is the part worth pinning. Nothing else:
    // the renderer talks to no remote API, and the providers are called from the
    // backend process.
    "connect-src 'self' http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // No `frame-ancestors`: Chromium ignores it in a meta tag and says so on the
    // console every launch. Nothing can frame a top-level file:// window anyway.
  ].join("; ")
}

const cspPlugin: Plugin = {
  name: "devsummary-csp",
  apply: "build",
  transformIndexHtml: {
    // `post`, so the hashes are taken from the HTML Vite actually emits rather
    // than from the source template.
    order: "post",
    handler(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(html)}">`
      // Placed by hand rather than with `injectTo`, which offers only the two
      // ends of <head>. It has to sit *after* the charset declaration — that one
      // is ignored past the first 1024 bytes, and this policy is ~600 of them —
      // and *before* every script, because a CSP meta governs only what follows
      // it. Between the two is the one position that satisfies both.
      const charset = /<meta\s+charset=[^>]*>/i.exec(html)
      return charset
        ? html.replace(charset[0], `${charset[0]}\n    ${meta}`)
        : html.replace(/<head>/i, `<head>\n    ${meta}`)
    },
  },
}

/**
 * `@assistant-ui/react@0.15.15` pins `assistant-cloud: ^0.1.41`, but the
 * `@assistant-ui/core@0.3.20` it pulls in peer-requires `^0.2.1` and imports
 * `assistant-cloud/ai-sdk` — a subpath 0.1.x does not export, which fails the
 * build outright. The sibling `@assistant-ui/react-*` packages already resolve
 * 0.2.2, so point every `assistant-cloud` specifier at that copy and let the
 * whole tree agree on one version.
 *
 * A bundler alias rather than a `pnpm.overrides` pin only because the lockfile
 * is not this change's to rewrite; replace it with the override when it is.
 */
function assistantCloudAlias() {
  const req = createRequire(path.join(__dirname, "vite.config.ts"))
  const cloud = createRequire(req.resolve("@assistant-ui/react-langgraph"))
  return [
    // Regex, not a string: a string `find` matches as a prefix, so the bare
    // specifier would also swallow the subpath and rewrite it to a file path
    // with "/ai-sdk" glued on the end.
    { find: /^assistant-cloud$/, replacement: cloud.resolve("assistant-cloud") },
    {
      find: /^assistant-cloud\/ai-sdk$/,
      replacement: cloud.resolve("assistant-cloud/ai-sdk"),
    },
  ]
}

// https://vite.dev/config/
export default defineConfig({
  // The packaged app loads index.html off disk with `win.loadFile`, so absolute
  // asset URLs ("/assets/...") resolve against the filesystem root and 404 — a
  // blank window with no JS and no API calls. Relative base keeps both the dev
  // server and the file:// load working.
  base: "./",
  plugins: [react(), tailwindcss(), cspPlugin],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${path.resolve(__dirname, "./src")}/` },
      ...assistantCloudAlias(),
    ],
  },
})
