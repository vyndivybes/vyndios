# Bill ageing and ledger reconciliation

These modules are read-only calculations, not posting, payment, close or approval authorities.

## Source contract

The canonical sources remain shipment-derived customer invoices and bank-evidenced collections under `/command/receivables`, approved supplier invoices and posted payments under `/command/payables`, and posted finance journals. Existing accounting authority, database maker/checker gates and append-only audit remain authoritative.

`computeReceivableAging` accepts invoices and receipt allocations. `computePayableAging` accepts the same invoice shape and payment allocations. Each allocation ID must be unique in the supplied snapshot. A bank receipt split across bills requires distinct allocation IDs; these functions do not deduplicate bank transactions or authorize bill allocations.

Callers must select one entity, INR currency and authorized source records, and supply complete invoice/allocation history. Draft, rejected, cancelled and reversed source records must not be represented as active invoices/payments. These modules do not query or change database records, infer posting authority, or reconstruct historical reversal state. Live database adapters and UI consumers are still required.

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

`npm run finance:parity:verify` exercises journal validation, voucher drafts, the original receivable regressions, ageing boundary cases, payable allocations and reconciliation differences/reversals. It is included in `npm test`.

Production adapters, persisted allocation controls, historical reversal reconstruction, source completeness checks and accountant-reviewed end-to-end reports remain unverified. No complete TallyPrime parity or live finance certification is claimed.
