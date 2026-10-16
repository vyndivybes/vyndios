# VYNDI OS without a Cloudflare deployment

Open GitHub Codespaces on branch `development/no-cloudflare-preview`, or clone it locally.

```sh
npm ci
npm run dev
```

Open forwarded port 8080 in the Codespaces Ports panel. The frontend and development server run inside the Codespace; no Cloudflare deployment is requested. Cloudflare-specific runtime bindings, authentication, database and external provider features may require **nonproduction** configuration. Do not store production secrets in the repository or Codespace.

The separate `offline-preview` workflow builds an artifact if GitHub Actions permits running it. This repository uses TanStack Start plus a Cloudflare Vite integration, so the generated `dist` directory is *not guaranteed to be a standalone static website*. A functioning browser preview should use the development server above.

GitHub may require a workflow on the default branch before the **Run workflow** button is available. Avoid merging this branch merely to expose the button while Cloudflare automatic builds remain connected.
