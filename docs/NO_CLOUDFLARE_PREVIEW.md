# VYNDI OS: Codespaces preview without a Cloudflare deployment

## Recover from `no local hyperdrive connection string` / HTTP 502

The `development/no-cloudflare-preview` branch now detects a GitHub Codespace during `vite dev`. **Only in the Vite development server**, it removes the Hyperdrive binding from the in-memory Cloudflare plugin configuration, allowing the existing PGLite fallback to run. The real `wrangler.jsonc` remains untouched. Production builds, deploys, and regular local runs retain the real Hyperdrive configuration.

In the **existing Codespaces terminal**, on this branch:

```sh
git status --short
git pull --ff-only origin development/no-cloudflare-preview
npm run dev
```

If `git status --short` lists local changes, first inspect them; do not discard work or force reset. If the `npm run dev` startup succeeds, open **Ports > 8080 > Open in Browser** and refresh the previous HTTP 502 page.

On a non-Codespaces machine, opt into the same embedded-database preview deliberately:

```sh
VYNDI_EMBEDDED_DB_PREVIEW=1 npm run dev
```

For Windows PowerShell use `$env:VYNDI_EMBEDDED_DB_PREVIEW='1'; npm run dev`.

**Limitations:** PGLite contains local, nonproduction data; existing company records and PostgreSQL-only transactions are not available in this fallback. Some finance, login, remote integration and Cloudflare-specific features may require a staging database or credentials. Never use production `DATABASE_URL` to test this preview and do not set a fake PostgreSQL URL.

No `wrangler deploy` or Cloudflare Pages/Workers production build is required. GitHub Codespaces may consume its own allowance.

## Fixing "Sign-in failed" in Codespaces

Codespaces runs a separate **temporary PGLite** database, not the production Hyperdrive database. Existing company credentials are **not** copied to the preview, and Better Auth does not recognize a first-time email/password login until that account exists in its local preview database.

1. Keep Codespaces port 8080 **Private**. Do not expose the preview publicly, and do not configure a production `DATABASE_URL`.
2. In the Codespaces terminal run `git pull --ff-only origin development/no-cloudflare-preview` and restart `npm run dev`.
3. Open the Codespaces port 8080 URL. On the login screen use **Create a preview account**, or go directly to `/signup` on that same port URL.
4. Choose a **new, preview-only password** (never reuse your production password). Sign in using those new credentials.
5. A new account begins as a **Viewer**, not as a Founder or Administrator. This preview verifies user-account login and Viewer-allowed functionality; it does not grant higher-level company privileges. Reopening or restarting an in-memory PGLite instance can lose accounts and data, requiring a new signup.

This branch permits `*.app.github.dev` as a Better Auth dynamic host and trusted origin **only when the Vite server is running in development mode**. It does not extend production authentication trust or disable password verification. This fixes host rejection but cannot automatically create an account in the user's running Codespace.

If login still fails, inspect the **Network** panel entry for `/api/auth/sign-in/email` and the terminal's `[auth]` diagnostics. Do not share passwords, session cookies, authorization headers or bearer tokens.

## Manual GitHub Actions workflow

The `offline-preview` workflow can prepare an artifact without a Cloudflare deploy. This project uses TanStack Start with the Cloudflare Vite plugin, so the resulting `dist` is not guaranteed to be a standalone static site. Use the Codespaces preview server for interactive UI evaluation. GitHub may require a workflow to be present on the default branch before it exposes the **Run workflow** button; do not merge solely to enable this while automatic Cloudflare builds are connected.
