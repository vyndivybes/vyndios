# Build & deploy target

VYNDI production is deployed through **Cloudflare Workers Builds**. The
canonical Worker is `vyndios`; no alternate production deployment adapter is supported
and must not be treated as release authority. `npm run build` must succeed and
emit valid Cloudflare-compatible output, and code that works under `npm run dev`
but breaks the production Worker build is a bug.
Watch for dev-only deps, server-only Node APIs run at import time, runtime
filesystem writes, and hard-coded ports / hosts / secrets.

## A passing `npm run build` does not mean the deployed app renders

The most common blank-deploy failure is
`Failed to load module script … MIME type "text/html"`: the built `index.html`
requests JS assets that 404 in prod, so the server returns the HTML fallback
(wrong MIME) and the page is blank. Fix the asset base path / build output so
`/assets/*` resolve, and ensure the SPA/SSR fallback doesn't shadow real asset
requests — then re-verify the served build renders.

If you edited source after kicking off the build, re-run `npm run build` first,
then `npm run preview:restart` — it frees `:8081` before serving, so you never
smoke the previous build's output.

## What `vite.config.ts` already does

The workspace ships a ready `vite.config.ts` and `tsconfig.json` — don't
recreate them, and don't import a vendored `vite-tanstack-config` preset. The
config:

- binds the dev port `0.0.0.0:8080`;
- pins `vite preview` to loopback `127.0.0.1:8081`, so the built output can
  never be picked up as the user's live preview;
- keeps the Cloudflare Vite plugin as the production adapter;
- must not retain alternate deployment compatibility code that can affect
  Cloudflare release behavior;
- mounts `grokPwaPlugin()`.

If you edit it, preserve both port contracts, Cloudflare production behavior,
and `grokPwaPlugin()`. Do not re-promote a legacy hosting adapter into release
authority.
