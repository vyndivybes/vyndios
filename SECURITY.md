# Security Policy

## Supported version

The `main` branch is the only supported production line for the VYNDI operating system. Preview and feature branches are not production releases.

## Reporting a vulnerability

Do not publish credentials, exploit details, customer data, authentication tokens, or reproducible attack payloads in a public issue.

Report security-sensitive findings privately to the repository owner or through GitHub's private vulnerability reporting feature when enabled. Include:

- affected route, component, workflow, or deployment surface;
- the observed impact;
- the minimum steps needed to reproduce the issue;
- whether the issue affects Cloudflare production, Grok preview, or only local development;
- suggested remediation if known.

## Security boundaries

VYNDI treats individual authentication, role assignment, transactional authorization, database truth, audit evidence, and deployment configuration as separate control boundaries. A preview-only condition must not be treated as production authority, and planning or advisory outputs must never become transactional truth without an authorised action in the owning workspace.

## Credential handling

Do not commit production secrets, database credentials, Better Auth secrets, provider credentials, API tokens, or private keys. Deployment secrets belong in the hosting provider's protected environment configuration.

## Finance-critical threat model and approval invariants

Primary risks include stolen finance sessions, insider self-approval, CSRF against authenticated writers, replayed approvals, unauthorized agent calls, and tampering with financial evidence. Security controls must be enforced on the server and in SQL, not in UI-only permission checks.

- All mutating finance actions require authenticated sessions, role permission checks and recorded actor IDs. Same-site/Origin and CSRF protections must be validated against **every** write endpoint by release-blocking tests.
- Production session cookies must be HttpOnly, Secure, and use an explicitly reviewed SameSite policy; authentication must never be turned off for production.
- Bank reconciliation approval rejects the preparer using a database-side predicate and cannot be replayed. CA evidence-pack approval rejects the generator and cannot be replayed.
- Period hard-close must refuse unresolved blockers; evidence packs must not become review-ready unless blockers are zero and the period is closed.
- Financial audit logs require documented retention, tamper-evident export, tested database restore and restricted access. Evidence retention must be checked with the appointed CA against applicable requirements.
- Finance mutations and privileged sign-ins require route-appropriate rate limits, session invalidation procedures, and alerting. Shared-IP limits must not substitute for per-account controls.
- All SQL must be parameterized. Never interpolate untrusted data into SQL identifiers or expressions; review changes to SQL security-definer functions separately.
- AI and VAOS advisory outputs have no direct posting or self-approval authority. Production writes require governed human authorization.
- A passing unit or code-level regression test is not a substitute for isolated database integration tests, end-to-end production-baseline validation, physical stocktake, reconciliation evidence or CA sign-off.

### Release acceptance evidence

Capture reviewed commit SHA, applied migration set, endpoint authorization and CSRF coverage, independent bank/CA-pack approval negative tests, all thirteen period-close blocker tests, a source-linked synthetic golden accounting journey, and verified backup/restore. Keep finance production posting on HOLD until the evidence is complete and independent reviewers approve the cutover. Never fabricate bank, GST, IRN, stocktake or payroll evidence to clear a blocker.
