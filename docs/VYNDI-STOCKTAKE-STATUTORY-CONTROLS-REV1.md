# VYNDI V1 — Stocktake & Statutory Controls · Rev 1

## Gate position

Production-hardening sequence:

**Main Protection → H1 Observability → H2 Backup/Restore → H3 Load Testing → H4 IAM/SoD → Stocktake/Statutory Controls → H5 Integrations → Final Production Certification**

Baseline for this gate: H4 merged and deployed green. This change does not reopen H1–H4 unless regression evidence fails.

## Control objective

VYNDI must prove that period-end physical inventory is reconciled to the canonical stock authority without direct quantity edits or a parallel stock ledger.

A stocktake follows this controlled chain:

1. **Snapshot** — capture authoritative book quantity, valuation and last movement timestamp for every active Master Inventory SKU/unit and every SKU/unit already present in the canonical inventory ledger.
2. **Physical count evidence** — record counted quantity, count-sheet/bin reference and evidence reference. A valuation basis is required for found stock when no book cost exists.
3. **Submit** — all lines must be counted and evidenced. Submission locks stocktake lines.
4. **Independent approval** — the stocktake preparer cannot approve the same stocktake.
5. **Post** — approved variances create canonical adjust inventory movements; quantity, FIFO and inventory cost stay synchronized.
6. **Finance linkage** — approved loss/gain value posts through the existing finance-journal authority:
   - shortage: Dr 5200 Manufacturing Overhead / Cr 1200 Inventory;
   - gain: Dr 1200 Inventory / Cr 5200 Manufacturing Overhead.
7. **Period-close evidence** — a finance hard close requires one posted stocktake for that YYYY-MM period and no draft/submitted/approved stocktake remaining open.

## Freeze-window invariant

The stocktake is not a moving reconciliation.

The snapshot stores both book quantity and the latest inventory-movement timestamp for each SKU/unit. Any receipt, issue, return, consumption or adjustment after the snapshot makes the affected line stale. Submission, approval and posting are blocked until a fresh stocktake is started.

This prevents the system from silently rebasing a physical count to a changed book balance.

## FIFO and valuation integrity

Stocktake does not overwrite an item balance.

- A **negative variance** posts a negative canonical inventory-ledger entry. The existing FIFO trigger consumes the oldest receipt layers. The exact FIFO allocation value is then posted to the inventory cost ledger.
- A **positive variance** posts a positive canonical inventory-ledger entry and creates a FIFO layer using the approved valuation basis.
- The linked finance journal uses the same monetary variance.
- Zero-variance lines create no inventory or finance transaction.

The stocktake therefore preserves one quantity truth, one FIFO truth and one accounting value trail.

## Scope integrity

The snapshot deliberately uses the union of:

- active master_inventory_items; and
- all SKU/unit keys already present in vyndi_inventory_balance.

This prevents an orphan ledger SKU from falling outside the physical count simply because its master-data row is missing or inactive.

## Maker/checker and evidence

The database records append-only stocktake events for:

- started;
- count recorded;
- submitted;
- approved; and
- posted.

Stocktake event rows cannot be updated or deleted. Stocktake count lines cannot be changed after submission. Posted stocktake sessions are immutable.

Operational permissions are inherited from the canonical Inventory workspace. Approval/posting require an approval-capable role; the database additionally rejects preparer self-approval/self-posting.

## Statutory boundary

This control improves period-close evidence and CA/audit readiness; it does **not** claim tax, Companies Act, audit-opinion or statutory certification by itself.

The existing statutory-finance authority continues to control GST evidence, ITC, bank reconciliation, payroll evidence, fixed-asset evidence, posting exceptions and trial-balance closure. Stocktake readiness is added as another mandatory hard-close blocker and is included in the CA evidence pack.

## Gate acceptance criteria

The Stocktake/Statutory Controls gate can be called **green** only when the exact branch/PR head proves all of the following:

- fresh database migration including 0087_stocktake_statutory_controls.sql;
- stocktake full-scope snapshot creation;
- physical count evidence completion;
- stale-snapshot rejection after a post-snapshot stock movement;
- maker/checker self-approval rejection;
- approved negative variance consumes FIFO correctly;
- approved positive variance creates a valued FIFO layer;
- canonical quantity and cost ledgers reconcile to the approved physical count;
- linked finance variance journal balances;
- stocktake event evidence is append-only;
- statutory hard-close authority requires posted stocktake evidence and no open stocktake;
- CA evidence pack includes the posted stocktake;
- TypeScript/type/build gate passes;
- existing H1–H4 and core CI remain green on the same exact head.

## Release boundary

Passing repository tests is necessary but not sufficient to claim Cloudflare production green.

After merge, deployment and production smoke evidence must be attached to the exact deployed SHA before this gate is marked deployed/green. H5 Integrations starts only after that evidence is green.
