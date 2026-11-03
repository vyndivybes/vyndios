# Stage 9 VAOS sender reference — pinned test fixture only

The original Stage 9 test used a second `actions/checkout` for private
`vyndivybes/vaos`, pinned to commit
`f8fa8ec2bcfb64e876d503d7a3a5a4d7c4353e2c`. The VYNDI OS repository
`GITHUB_TOKEN` does not automatically have `contents:read` permission to the
other private repository, so checkout failed before any signed loopback test ran.

This directory contains **only the three exact upstream VAOS source files**
needed by the existing test, retrieved at that same immutable commit. The
upstream Git blob IDs are locked in `SOURCE-PIN.json`; the test
`node --test scripts/stage9-pinned-vaos-reference.test.mjs` recomputes each
original Git blob SHA-1 from the file's UTF-8 bytes and fails if any are changed.
An independent GitHub read should also confirm that these blob IDs match the
named upstream commit when reviewing a pin update. Git SHA-1 authenticates
**exact-object consistency**, not a new remote fetch on each run. New revisions
must be deliberately re-reviewed, never auto-fetched from a moving branch.

Only the isolated Stage 9 PGlite/signed localhost test imports these copies.
They are **not** deployed, bundled, treated as current VAOS production code,
or used to authorize VYNDI operations. The local PGlite, replay rejection,
ECDSA signature, separation-of-duties and zero-payment checks remain intact.
No new GitHub PAT, app secret, token, cross-repository permission grant or
paid service is needed.

**Scope of qualification:** P2P compatibility with a fixed historical VAOS
sender at the exact commit above. This is **not** evidence that latest VAOS main,
the neural graph feature PR, or a live Cloudflare service are mutually
commissioned. A fresh same-commit or current-head cross-repository test still
needs separately authorized credentials or a reviewed later source-pin refresh.
