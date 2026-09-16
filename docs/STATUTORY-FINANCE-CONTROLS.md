# VYNDI Statutory Finance Controls

## Purpose

This control layer converts the transaction-derived accounting backbone into a CA-reviewable close process. It governs evidence and reconciliation; it does **not** claim that VYNDI itself files returns, gives legal/tax advice, or certifies statutory books.

## Controlled flow

### Output GST / customer invoice

1. Operations posts dispatch.
2. Finance issues a controlled customer tax invoice from the dispatch value.
3. The invoice records recipient identity/address, place of supply, HSN/SAC, tax treatment/rate, CGST/SGST/IGST, gross receivable and tax evidence.
4. Where the transaction is governed as e-invoice applicable, IRN acknowledgement evidence is mandatory before issue.
5. Accounting posts gross Trade Receivable, taxable Product Revenue and Output GST Payable.
6. Collections settle the gross receivable, including GST.
7. Voids create linked accounting reversal and reverse the output-GST ledger record.

Historical invoices that pre-date the controlled tax profile remain visible as pending reconciliation; they are not silently rewritten.

### Input GST / supplier invoice

1. Procure-to-pay captures the GST-bearing supplier invoice.
2. Before AP approval, Finance classifies its input tax in **Input GST / ITC Review**.
3. Eligible ITC requires explicit eligibility plus evidence. Document presence alone is not eligibility.
4. Verified eligible GST posts to Input GST / ITC.
5. Ineligible GST is retained in inventory/cost rather than overstating a tax-credit asset.
6. Pending classification blocks approval of a GST-bearing supplier invoice.
7. Historic input-GST records created before this control are marked unverified until reconciled.

## Bank reconciliation

A bank-period close requires:

- every imported statement line matched to a posted Bank journal, or a documented zero-activity period;
- no posted Bank journal for the period left unrepresented by the statement match set;
- statement movement equal to Bank-GL movement;
- opening balance + statement movement = closing balance;
- explicit preparer evidence and separate approval evidence.

Every match and unmatch is audit logged. A matched journal cannot be reused for another bank-statement line.

## Period close

Statuses:

- `open`
- `soft_closed`
- `hard_closed`

Hard close requires approval and refuses to proceed while controlled blockers remain, including bank reconciliation, GST/tax evidence, input-ITC classification, invoice tax profile/IRN evidence, payroll evidence, fixed-asset evidence, finance-posting exceptions or trial-balance imbalance.

A hard-closed period blocks new/changed journal posting into that period. Posted journal headers and lines are immutable; corrections use linked reversal journals in an open period.

Reopening a hard-closed period is itself an approval-controlled, evidence-recorded event.

## CA evidence pack

A period evidence pack captures a point-in-time snapshot of:

- blocker status;
- period-close status and evidence;
- GST period summary;
- bank-reconciliation evidence;
- generation identity and timestamp.

Only a blocker-free pack from a soft/hard-closed period becomes `review_ready`. Approval is a separate governed action.

## Reliance boundary

VYNDI provides management-accounting records, transaction lineage, evidence controls, reconciliation and close governance. GST/TDS returns, tax/legal interpretations and externally certified statutory books remain subject to applicable law and the appointed Chartered Accountant or other authorised professional.
