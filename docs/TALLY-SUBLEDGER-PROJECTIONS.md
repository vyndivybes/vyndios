# Bill ageing and ledger reconciliation

These modules are read-only calculations, not posting, payment, close or approval authorities.

## Source contract

The canonical sources remain shipment-derived customer invoices and bank-evidenced collections under `/command/receivables`, approved supplier invoices and posted payments under `/command/payables`, and posted finance journals. Existing accounting authority, database maker/checker gates and append-only audit remain authoritative.

`computeReceivableAging` accepts invoices and receipt allocations. `computePayableAging` accepts the same invoice shape and payment allocations. Each allocation ID must be unique in the supplied snapshot. A bank receipt split across bills requires distinct allocation IDs; these functions do not deduplicate bank transactions or authorize bill allocations.

Callers of the pure calculation modules must select one entity, INR currency and authorized source records, and supply complete invoice/allocation history. Draft, rejected, cancelled and reversed source records must not be represented as active invoices/payments. The pure modules do not query or change database records or infer posting authority. Both database adapters reconstruct historical state from posted journals and are called by on-demand panels in their existing workspaces.

## Calculation rules

- Dates are strict Gregorian `YYYY-MM-DD` calendar dates, compared in UTC without local timezone shifts.
- An invoice issued after the cutoff is excluded. An allocation after the cutoff does not reduce that report's outstanding amount.
- All supplied rows are validated, even future rows. Duplicate IDs, orphan allocations, allocations before invoice issue, and total allocations exceeding the bill fail closed.
- Amounts use safe integer paise. Negative, nonfinite and fractional-paise amounts are rejected. Invoices may be zero; allocations must be positive. Advances and unapplied cash require a separate evidenced source treatment and are not clamped into bill balances.
- Due today is not overdue. Buckets are not due, 1–30, 31–60, 61–90 and over 90 days overdue. Settled bills remain visible with zero outstanding for traceability.

## Reconciliation boundary

`reconcileSubledger` compares the supplied ageing total to account `1100` for receivables or `2000` for payables, using debit-normal and credit-normal balances respectively. It includes only posted journals dated on or before the cutoff, matching the existing general-ledger projection. Include opening entries and separately posted reversals. Duplicate journal IDs and invalid posted journals fail closed.

The result contains contributing journal IDs, ledger balance, subledger balance, signed ledger-minus-subledger difference and exact-paise equality. Equality is diagnostic only. It cannot prove that the caller supplied complete records, matched the same entity/date scope, or applied historical reversal rules correctly. It cannot approve a bank reconciliation, financial close or statutory filing.

## Verification

`npm run finance:parity:verify` exercises journal validation, voucher drafts, the original receivable regressions, ageing boundary cases, payable allocations, reconciliation differences/reversals and the payable database report. It is included in `npm test`.

## Payable database report

`getPayablesAgingReport({ data: { asOfDate } })` is a read-only TanStack GET server function. It requires existing view permission for `/command/payables` before opening the database. The existing Payables workspace calls it from an on-demand report panel. An unavailable report does not block the invoice/payment registers.

The panel requires an explicit report date and displays exact-paise bill totals, ageing buckets, posted GL balance, signed difference and supporting journal IDs. Changing the date clears the previous snapshot and invalidates any in-flight result. Starting a local payable mutation remounts the report panel so its prior snapshot cannot be mistaken for current balances. Loading, error, empty and difference states are explicit; a diagnostic match never grants approval.

`loadPayablesAgingReport` reads invoice, payment, supplier-return and journal data in a single SQL statement, so concurrent changes cannot mix snapshots. No result limits silently truncate the books. The current schema holds the single Vāyú Shastr entity and INR invoice amounts; no caller-supplied tenant/company selector is accepted.

Historical inclusion follows posted journal entry dates, not today's source status or the reversal processing timestamp. Original payments remain included before their dated reversal even when their current source status is `reversed`. Invoice voids likewise take effect on the posted reversal date. A backdated entry changes the report for that entry date; this is accounting-date reporting, not a reconstruction of what users knew at a past processing timestamp.

Supplier debit notes reduce bills only by `ap_offset_inr`. Their separate account-1400 recoverable amount does not reduce payable ageing again. Original journal dates and AP values must agree with source records. Missing posting evidence, missing reversal evidence for void/reversed records, invalid due dates and unsupported allocations stop the report rather than creating inferred balances. Legacy payments without posted journal evidence therefore require investigation before the report can be produced.

All posted account-2000 entries, including opening and unmapped manual postings, participate in GL comparison. An unmapped posting can produce an explicit difference. A zero difference remains diagnostic; it does not approve reconciliation, payment, period close or statutory filing. The existing chart validation rejects unsupported account codes instead of certifying unfamiliar journal structures.

Tests run the real migrations and supplier-payment/reversal/return functions in isolated PGlite, check prior-date and current-date balances, and verify no journals/audit events are created by report reads. Authorization tests execute the report handler with controlled identity/database boundaries and verify rejection occurs before database access.

## Receivable database report

`getReceivablesAgingReport` requires the existing Receivables route view permission before database access. The adapter reads invoices, collections, credit notes, refunds and posted journals in one SQL snapshot. Journal entry dates own accounting cutoffs, including sources whose timestamps were converted in the database session's timezone. Current source status does not erase the history before a dated reversal.

Customer credit balances are retained separately and deducted from outstanding bills for signed GL reconciliation. They are not clamped away. Credit notes and refunds are validated against their source amounts and linked invoices. The report retains a breakdown of gross invoice, collected, credited, refunded, outstanding and credit balances. Ageing classifies the derived open amount; it does not manufacture payment allocations.

Legacy invoices without evidenced terms/due dates remain in total balances and GL comparison, but are listed as unaged. A diagnostic GL match can therefore coexist with explicitly incomplete ageing. No due date is inferred. There is no durable customer-master key on these invoice rows: the displayed source reference is the sales-order/spare-sale reference, not a fabricated party identity. Party-wide allocation/migration remains a separate requirement.

The existing Receivables screen now obtains current open/refund amounts from the canonical sales-ledger view, so credit notes and refunds are not ignored in its KPI, register or collection selector. Receivables reads/writes check the route's authorization; voids and collection reversals additionally require approval permission. Migration `0195` enforces an independent finance/admin actor at the reversal/void database boundary and prevents voiding an invoice with active customer credit notes.

## Posting integrity migrations

- `0194` rejects fractional/negative/unsafe paise and even a one-paise imbalance in canonical SQL posting. Source retries must match existing date, description and normalized lines. A source lock serializes competing retries.
- `0195` preserves the existing cash, journal reversal and audit paths while adding independent approval checks.
- `0196` permits journal construction within the posting transaction, rejects later line inserts into posted journals, and defers exact balance/safe-paise checks until transaction commit. Existing posted UPDATE/DELETE immutability and hard-close triggers remain in force.

These migrations were authored for controlled application, not applied to live books. Real PostgreSQL rehearsal, concurrent-client testing, accountant-reviewed reports, production scale, authenticated full-application browser journeys and live deployment remain unverified. Existing collection/cash storage in four-decimal lakh units cannot represent arbitrary paise and remains a separate release blocker. See the dated audit report for remaining work. No complete TallyPrime parity or live finance certification is claimed.
