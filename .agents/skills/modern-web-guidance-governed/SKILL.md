---
name: modern-web-guidance-governed
description: Consult reviewed Google Chrome modern-web guidance when changing client-side performance, accessibility, or web APIs.
---

# Modern web guidance — governed workflow

Upstream: https://github.com/GoogleChrome/modern-web-guidance (Apache-2.0). This is a repository-local workflow, not a vendored upstream package.

1. Read the current browser tests and supported browser matrix. Prefer accessible native platform APIs, progressive enhancement, reduced-motion handling and robust loading/error states.
2. On an authorized development machine, review the exact release, then use the installed modern-web-guidance CLI to search relevant rules and perform a legacy scan; upstream documents modern-web-guidance search "query" and modern-web-guidance legacy-scan .
3. If the CLI is absent, mark automated guidance **HOLD**, use official web documentation and existing tests, and do not claim a completed scan.
4. Never silently install floating-version packages, transmit company source to an unapproved service, or introduce paid API dependencies.
5. Apply changes on a branch; run UI, Playwright, accessibility and security tests.
6. Purchases and external communications continue to require founder approval; development advice grants no business permissions.
