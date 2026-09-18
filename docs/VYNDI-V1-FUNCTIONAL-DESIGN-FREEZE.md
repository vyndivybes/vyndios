# VYNDI V1 Functional Design Freeze

**Frozen functional baseline:** `ee47744b89b9f9aa16da0c110fc0cdfa8471c426`  
**Status:** Release Candidate baseline before enterprise-hardening H1–H5.

The baseline includes the governed transaction chains for demand, product/BOM, inventory, procurement, production, quality, finance, actuals, Sales Ledger, spare/component sales, AR/AP, verified canonical cash, People & Office actual spend, payroll/fixed-asset source authority, customer returns/credit notes/refunds, and supplier returns/debit notes/refunds.

## Freeze rule

Broad business-feature expansion pauses at this baseline. Subsequent work must be hardening, validation, recovery, access governance, controlled integration, or a separately approved defect correction.

Hardening sequence:
1. repository branch protection/ruleset — administrative GitHub control;
2. H1 observability/SLO foundation;
3. H2 backup/restore/recovery drill;
4. H3 performance/load qualification;
5. H4 IAM/segregation-of-duties/access certification;
6. remaining stocktake/statutory-settlement controls;
7. H5 governed external integration contracts;
8. exact-SHA production certification.

The freeze does not imply that VYNDI is permanently finished. It establishes a controlled V1 functional baseline from which enterprise production hardening proceeds.
