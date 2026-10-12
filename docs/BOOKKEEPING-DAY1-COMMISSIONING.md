# VYNDI OS — Day-1 Bookkeeping Commissioning Standard (India)

## Intended decision

The **software** is accepted *before* the company starts using it to maintain books. A first month or year does not have to have ended, and no physical stocktake, bank reconciliation session, CA review pack, GST return or payroll return needs to exist to qualify the software for its first use. Those are **later, transaction-dependent obligations**.

Do **not** confuse these statuses:

- `QUALIFIED_FOR_DAY1_BOOKKEEPING`: evidence-backed technical and operational capability to begin recording real transactions.
- `NOT_YET_QUALIFIED`: at least one pre-use capability has not been independently proved. This is **not** a failing accounting period.
- `PERIOD_REVIEW_READY`: after ordinary operations, period-specific blockers, reconciliation and supporting records are cleared.
- `CA_AUDIT_ACCEPTED`: conclusion reached separately by the appointed independent CA; the software cannot self-certify it.

## Regulatory scope (verify ongoing amendments with appointed CA)

- Companies Act 2013, section 128: accrual and double-entry company books, voucher preservation for at least the specified eight financial years, retrieval/inspection.
- Companies (Accounts) Rules 2014, rule 3: accessible electronic records; from FY 2023-24 audit trail/edit log for each and every books transaction and every change, date/time and non-disableability; Indian-location backup of electronic books, including any books hosted outside India, at the prescribed daily cadence; annual service-provider disclosures.
- Companies (Audit and Auditors) Rules 2014, rule 11(g): auditor separately tests audit trail use, coverage, integrity and preservation.
- CGST rules 56/57 and CGST Act section 36 where GST applies: tax records, electronic edit logs and retrievable backup, with applicable GST retention periods.
- GST/TDS filing, an audit opinion and tax positions remain external responsibilities. VYNDI records evidence and allows exports; it must not describe itself as CA-certified.

Reference legislation: https://e-book.icsi.edu/Actpagedisplay.aspx?PAGENAME=17511 and https://e-book.icsi.edu/Actpagedisplay.aspx?PAGENAME=18052 ; ICAI guide https://publication.icai.org/publication/1063 .

## Day-1 evidence acceptance

`src/lib/finance/bookkeeping-day1-acceptance.ts` defines the **18 required control identifiers** and a deterministic classifier. Every requirement must be supported by a **real, reviewable artifact**, verifier identity, UTC timestamp and the current exact 40-digit release SHA. A claimed PASS in a manifest is not proof of its content: assessors must read the linked evidence and test the control.

1. **Ledger / transaction integrity**: prove accrual, balanced source-linked posted journals, reversals, period locks, and financial statements. Run a complete isolated synthetic transaction chain, including PO, receipt, material issue, job cost, FG, dispatch COGS, invoice, collection, bank matching, reversal and trial balance.
2. **Security / governance**: test finance endpoint authentication, authorization, origin/CSRF controls, SQL maker/checker for privileged approvals, no AI autonomous posting, rate limits and exact release SHA. Test forbidden operations as well as allowed ones.
3. **Mandatory audit trail**: prove *every* financial source table and books mutation has a dated immutable edit log, including draft insert/update/delete, actor, before/after values, reversal and automated posting. Use an audited table inventory and negative tamper/disable/delete tests. Journal immutability alone is insufficient.
4. **Evidence / export / retention**: sample source voucher attachment; reconstitute general ledger, TB, AR/AP, bank, inventory valuation, GST/TDS working papers and audit edit logs in open, legible machine-readable formats. Test retrieval and a retention policy covering statutory years and the longer applicable obligation.
5. **India backup / recovery**: document provider and physical backup region, daily completed backup receipt, encryption and access controls, a separate restored database, integrity hash comparison and recovery log. **US East production hosting does not prove an India-located backup.** CI's synthetic recovery drill alone is not proof of live daily India backups.
6. **Tax / business onboarding**: confirm real company identity, books start date, financial year, INR, GST registration/applicability and e-invoice applicability, TDS profiles and actual opening balances (or a documented legitimate nil opening). Do not invent a CIN, GSTIN or other official number when unavailable.
7. **Operational operator acceptance**: two authorized roles where required, protected finance UI and errors, day-one runbook and a read-only CA handover sample. A direct Playwright browser login test supplements rather than substitutes for database controls.

## Separate lifecycle obligations — NEVER included in Day-1 admission

- A bank session can only be independently approved **after** a real statement and ledger exist.
- A stocktake can only be posted **after** an authentic physical count.
- GST/ITC/IRN, TDS, payroll and fixed-asset evidences are required where an applicable real transaction exists.
- The thirteen `periodBlockers` are exercised in negative qualification with **synthetic records**, but production `blockerCount=0` is required for actual **period closure**, not first-use commissioning.
- No CA evidence pack or signed statutory opinion is expected before bookkeeping starts.

## Acceptance artifacts

Produce a signed/verified Day-1 assessment with: requirement ID; test name; source/output evidence URI; verifier; timestamp; release SHA; outcome; and a list of not-yet-proven capabilities. For legal location/backups and retention, include provider documentation and inspection of the actual backup or restore. Do not mark evidence as passed merely because a test file exists.

**Current observed gaps at preparation:** live non-disableable edit trail across all source records has not been independently proven; India's daily backup location has not been proven; complete isolated finance chain and browser authorization need consolidated evidence. These gaps are **pre-use system qualification work**, not missing bank/stocktake activity for September 2026.
