# Fireflies meeting intelligence — governed VYNDI OS boundary

**Status: UNVERIFIED / NOT DEPLOYED.** Scope is a proposed integration contract; no Fireflies API key, OAuth token, transcript, new table, or live route is introduced by this document.

## Authority and routing

Fireflies is an **external meeting-evidence source**, not a business authority. VYNDI's H5 governed integrations remain the canonical provider ingress. Do **not** create a parallel finance, inventory, procurement, engineering, or project ledger.

```text
Fireflies remote MCP (owner-authorized, read-only)
  -> VAOS provider boundary (secret binding, RBAC, rate limit, evidence provenance)
  -> H5 governed inbox/validated evidence reference
  -> existing VYNDI decision / action-inbox views, only after reviewed mapping
```

Raw transcripts should not be imported by default. Show attributable, link-backed meeting summaries and candidate tasks in the canonical Command Centre / Decision Inbox. Converting a meeting action item into a purchase order, payment, inventory movement, engineering release, or workflow execution **must** require existing actor identity, approval, and canonical application rules. Never let external meeting text drive autonomous mutations.

## Minimum qualification

1. Owner authorizes the separate Fireflies credential; configure in the hosting platform's secret store, not repository or database.
2. Provider read-only scope permits user identity, bounded transcript search, and single-meeting summary retrieval. Disable sharing, deletion, privacy changes and autonomous recording.
3. Apply per-tenant access isolation and project permission checks before any external read or business-facing display.
4. Validate provider response schemas, meeting id, timestamps, organizer/participants as permitted, source link, consent, and confidence; treat transcripts as untrusted input.
5. Bound requests within current free-tier quotas (Fireflies Free/Pro: 50 API requests/day, subject to vendor terms); retries must not multiply usage.
6. No public navigation or duplicate top-level dashboard. Use the existing H5 and action-inbox governance.
7. Add focused tests for authentication denial, tenant separation, external prompt injection, bounded reads, rate limit, no mutation, audit and secret redaction.
8. Qualify exact commit tests/build/CI, deployment revision and production consented-meeting smoke before any `PRODUCTION_VERIFIED` claim.

The Fireflies endpoint is `https://api.fireflies.ai/mcp`. Its authorization is **not transferable** from ChatGPT to VYNDI OS. This document is intentionally implementation-neutral until a VAOS provider adapter and evidence mappings are qualified.

References: `docs/VYNDI-H5-GOVERNED-INTEGRATIONS-REV1.md`; `AGENTS.project.md`; https://guide.fireflies.ai/articles/8272956938-learn-about-the-fireflies-mcp-server-model-context-protocol

## Implementation update (29 October 2026)

`src/lib/fireflies-meeting-evidence.ts` implements a fail-closed mapper from an independently authorized VAOS Fireflies summary response to `VibpeKnowledgeEvidence` classified `external-reference`. It rejects mismatched accounts, missing approval, transcript operations and malformed/markup-tainted summaries. It cannot authorize business transactions and does not persist raw transcripts. `scripts/fireflies-meeting-evidence.test.mjs` is included in the repository test scripts and passed three focused isolated tests.

**Not live:** the H5 approved contract, actor-authenticated server invocation, VAOS API route, production credential, consented meeting smoke, CI verification and deployment have not been completed. This code is an advisory evidence adapter, not a production import or autonomous workflow.

