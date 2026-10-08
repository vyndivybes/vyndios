# VYNDI Master Program — DRAFT-0.1 (2026-10-09)

**Governance: UNAPPROVED / FILE-STAGED ONLY — NOT IMPORTED TO CANONICAL BUSINESS TABLES**

## Contents

- `VYNDI-MASTER-PROGRAM_DRAFT-0.1_2026-10-09.csv`: 71 proposed tasks, each with workstream, title, role-level owner, indicative effort, predecessor IDs, relative-order offsets, source link and explicit `UNAPPROVED_SOURCE_DRAFT`.
- [Editable Google Sheet — master plan, 71 tasks, 103 proposed dependencies, 14 sources, release gates](https://docs.google.com/spreadsheets/d/1EOMzpS03YqJwFkQQux4uBXCVP72jvB5VJm17eXI4GFg/edit).

## How compiled

Evidence was gathered from chat-derived design and business decisions, Drive-controlled VEDM/TANSAM/PSG-STEP records and actual VYNDI OS production schema. As checked 2026-10-08 UTC:
- VYNDI `vyndi_programs` includes `VYNDI-MASTER-PROGRAM` in ACTIVE state;
- VYNDI `vyndi_program_tasks` for that program: **0**;
- VYNDI `vyndi_program_dependencies`: **0**;
- VAOS independently approved program baseline entries: **0**.

## Deliberate release hold

This CSV is **not** executed as SQL and is not input to the live `vyndi_program_tasks` or `vyndi_program_dependencies` tables. The latter feed real VIBPE planning and source-bound VAOS controls and must not be silently populated with provisional dates, durations or role placeholders.

All task statuses are `DRAFT_ONLY_NOT_AUTHORIZED`, intentionally not one of the database's live `planned|ready|in_progress|blocked|complete|waived` states; this prevents accidental presentation as approved work. Relative T+ offsets and draft workday durations are purely exploratory. Calendar deadline cells are blank.

Before a governed import:
1. Owner/engineering authority reviews title, scope, role and dependencies.
2. Real accountable task owner(s), schedule dates, source references and milestone evidence are confirmed.
3. The business timezone and finish-day cutoff are explicitly approved, since VYNDI stores `date` without time zone but VAOS requires an offset-aware deadline instant.
4. A separate checker approves an immutable SHA-256-bound baseline revision; no maker/self certification.
5. Only then the authorized normal VYNDI planning workflow accepts records, and a separate VAOS live read/negative qualification occurs. Automated `PROJECT.ESCALATE_BLOCKER` remains human-gated.

Source decisions remain non-release as applicable: MATERIAL-01 open, current-design P1 manufacturing and ISO4210 completion unverified, TANSAM/TANCAM/PSG-STEP workshare/commercial terms not automatically agreed.

## Links

- [VYNDI weekly status review 2026-10-02](https://docs.google.com/document/d/1a_VvJ72xsr1NB2oyjtMKA8sEYcdMmrpgCNwyzPJFZZA/edit)
- [TANSAM requested workshare](https://docs.google.com/document/d/1_cNHgLSGYKY0evigj5bW6dcKXG_VdrQYFrwUcWVo7VQ/edit)
- [TANSAM phase matrix Rev1.0](https://docs.google.com/document/d/1NTWuM7DoFdDSAg2JCdTzdewA7Vfx634a9wBl8OEBLXI/edit)
- [VIBPE engineering controlled source register](https://docs.google.com/document/d/1U970kDZKpIQIaPZc3EfjBjsgB-Q4ZcCGHVaX9iRV6Cw/edit)
- [VAOS first-project baseline readiness record](https://github.com/vyndivybes/vaos/pull/89)
