# VYNDI OS — Digital Employees 5P Commissioning Plan

**Status:** Stage 1 roster and fail-closed eligibility contract only; no new autonomous workers or production execution are claimed. This plan follows `docs/VYNDI-BUSINESS-OPERATOR.md` and the repository's evidence verification skill.

## Architecture

**VIBPE Co-Pilot 2.0** remains the conversational entry point. Eight proposed digital employees are domain-specific observers/analysts, not separate sources of business truth:

| ID | Specialist | Owning truth | Advisory output |
| --- | --- | --- | --- |
| planning | Planning & Forecast Analyst | 36-month plan and IBPE | Demand, funding, capacity exceptions |
| commercial | Commercial & CRM Analyst | CRM and sales-order ledger | Order and fulfillment risks |
| procurement | Procurement Analyst | Procurement and approved supplier records | Shortages, supplier risk and draft replenishment |
| inventory | Inventory & Stores Analyst | Master Inventory / Store 01 | Stock, FIFO, quarantine and GRN exceptions |
| production | Production & MES Analyst | Job cards and Traveller | Capacity and release blockers |
| engineering-quality | Engineering & Quality Analyst | Engineering and QMS | Configuration, NCR/CAPA and release evidence |
| finance | Finance & CA Audit Analyst | Financial cockpit and Tally | Cash, reconciliation and CA exceptions |
| people | People & Office Analyst | People Office and its ledger | Staffing, spending and asset control |

Bike fitting and cycling performance remain specialist analytical modules, not additional autonomous employees. The roster at `src/lib/vyndi-digital-employees.ts` is a **candidate registry**, not proof of runtime operation.

## 5P implementation sequence

### P1 — Plan: verify the starting position
- Map every proposed role to an existing authorised data service, actual owned record, responsible operator and required approval gate.
- Establish `main` SHA, deployed Cloudflare SHA, DB/migration readiness and signed-in route health.
- Address the first observed production blocker: `/command/purchase-execution` returned HTTP 500 in Production Assurance on 2026-11-15.
- Distinguish source presence from synthetic test, authenticated read, autonomous scheduling and live production outcome.

**Gate:** eight role/source contracts and baseline blockers recorded.

### P2 — Prepare: safe candidate contracts
- Introduce an eight-role roster with clear domain, source paths and intended work packet.
- Only `observe` and `prepare` can be eligible, never autonomous `execute`. Require verified upstream actor, source identifier, 40-character SHA, governed-internal authority and fresh evidence.
- Keep RBAC, maker/checker, engineering release, CA and transaction authorization in owning existing workflows; the proposed eligibility function **does not grant permissions**.
- Prove missing actor, missing evidence, stale source and ungoverned reference all fail closed.

**Gate:** reviewed source-only PR; synthetic unit tests; no production change.

### P3 — Proceed: source-backed observer adapters
- Build eight authenticated, read-only domain adapters against canonical business tables/services.
- Each operation follows `source -> validation -> reconciliation -> exception -> advisory packet -> audit receipt`.
- Packets capture source IDs, input fingerprints, actor attribution, timestamps, explicit `HOLD`s and owning workspace links.
- Preserve idempotency and avoid duplicating ledger truth. Integrate existing VIBPE/VAOS signed bridges only after their authorization gates are tested.

**Gate:** eight role-specific live-data reads and audit evidence, all independently checked.

### P4 — Perform: event-driven analysts
- Use existing Cloudflare Workers/scheduler and storage only within **confirmed free quotas**, no new paid APIs, LLM keys or services.
- Poll or react to actual source changes; perform bounded analyses of material shortages, orders, production, finance, quality and HR.
- After separate per-role write qualification and explicit owner authorisation, allow **scoped, reversible writes** only through existing authenticated owning workflows: e.g. CRM follow-up notes, planning task updates, draft RFQs, draft NCRs and office checklists. Validate role, input evidence, idempotency and append-only audit on the server; never accept an advisory gate as a permission check. Financial commitments, purchase-order issue, accounting posting, engineering approval and production release remain under their distinct maker/checker or statutory authorities.
- Show `last observed | source | finding | HOLD | next owner action` in one human-readable command center.

**Gate:** repeatable signed work receipts, permission-isolation tests, no unauthorised writes, monitoring and recovery evidence.

### P5 — Persist: qualify, learn and certify
- Run the full repository test/typecheck/build suite, authenticated Playwright acceptance and exact-SHA Cloudflare qualification.
- Measure false alerts, missed blockers, useful decisions, stale data, running costs, operator corrections and impact of proposed actions.
- Store feedback within existing audit and knowledge controls, not as unapproved changes to master data or unsupported self-training claims.
- Qualify each digital employee separately: `CODED -> TESTED -> BUILD_GREEN -> SMOKE_GREEN -> MERGED -> DEPLOYED -> PRODUCTION_VERIFIED`. A missing gate remains `UNVERIFIED` or `FAILED`.

**Gate:** independent production evidence for each role and workflow.

## Stage 1 scope / non-goals

This PR adds only candidate metadata, a fail-closed non-executing eligibility check, synthetic tests and this plan. No DB migration, cron job, business action, UI page, paid compute, new token or production deployment is introduced. A `PREPARED` verdict means permission to *propose an advisory work packet*, not permission to write or transact.

The existing runtime QA must remain separate. A synthetic test cannot establish that any of these employees is continuously running, correctly using real records or production-qualified.
