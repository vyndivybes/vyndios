---
name: cloudflare-security-audit
description: Run a scoped, evidence-led Cloudflare security audit with independent verification and fail-closed release gates.
---

# Cloudflare security audit bridge

Upstream: https://github.com/cloudflare/security-audit-skill (MIT).
This bridge points to the upstream skill; it does not vendor validators or claim a complete audit.

1. Map route auth, Workers bindings, Supabase/Hyperdrive trust boundaries, webhook signatures, supply-chain releases, write permissions and prompt-injection surfaces.
2. Run the upstream skill only if its reviewed revision is installed in an authorized agent and an OS-enforced sandbox is available (no network, sanitized variables, limited CPU/memory, scratch-only writes).
3. Build architecture.md and validated coverage-ledger.json, then hunt by coverage unit and validate candidates offline.
4. Each candidate requires an **independent verifier** who tries to disprove it. Check findings against the upstream schema. Use confirmed, needs_validation, and rejected; do not assign severity to unverified leads.
5. Without the sandbox, validators, isolation or independent review, mark **HOLD** / needs_validation; do not report a full security audit from a checklist.
6. Remediations require regression tests, rollback and approval. Audits cannot override founder approval for purchases or external communication.
