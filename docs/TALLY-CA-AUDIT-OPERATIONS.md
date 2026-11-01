# Tally / CA Audit — Operator Guide

## Available workflow (read-only)

In **Finance → Financial Statements**, use the **Tally / CA reconciliation** panel. This panel uses the existing authenticated `getAccountingStatements` loader and the actual posted VYNDI journal-derived trial balance; it does not rely on planning state. Existing server-side finance view permissions apply.

1. Select the required financial year / accounting dates in Financial Statements and apply the period.
2. Export the matching period and **correct company** from TallyPrime. Only verified **leaf-ledger balances** are comparable. The native TallyPrime Trial Balance XML may include group aggregates, so do not interpret its raw display rows as ledgers.
3. Prepare a UTF-8 CSV with exactly `Ledger,Debit,Credit` as header and nonnegative INR amounts. Example:

   ```csv
   Ledger,Debit,Credit
   Tally Bank,100.00,0.00
   Tally Capital,0.00,100.00
   ```

4. Supply an **explicit, independently reviewed** JSON mapping of Tally ledger names to VYNDI posted account codes:

   ```json
   {"Tally Bank":"1000","Tally Capital":"3000"}
   ```

5. Select the CSV in the browser. The panel calculates its SHA-256 digest locally. It does **not** upload the file, send it to Tally or modify VYNDI accounting records.
6. Confirm the company, period and ledger-grain basis. Compare balances.
7. Review missing, mismatched or invalid ledgers. Download a JSON review report if required. The exported report contains the CSV hash, VYNDI period, reconciled statuses and exceptions; **it is not a CA-signed audit pack**.

### Boundaries

- The CSV must be a normalized, manually checked Tally-derived export. **Direct TallyPrime connectivity is not present.**
- The tool compares posted VYNDI balances against mapped Tally balances and blocks missing or inconsistent accounts.
- It checks that the VYNDI source has posted journals. It cannot independently verify Tally source authenticity, company, period, record completeness, accounting standards, GST returns, TDS/TCS, or source-document legitimacy.
- The local comparison is ephemeral; navigating away does not persist uploaded data. Only a user-initiated JSON report is downloaded.
- Only an appointed CA or other legally authorized reviewer can provide applicable statutory certification, after verifying source evidence.
- There is no automatic tax filing, company-book mutation, journal posting, network port or Tally writeback.

## Production gate

- Dedicated Finance CI must pass.
- Full development regression, typecheck and bundle must pass at the latest commit.
- Reviewer should test with representative, authorized exports and validate account-code mapping and real opening/closing balance conventions.
- Never merge/release this feature merely because arithmetic examples pass. Production rollout is separately governed; the existing `main` production Worker is unchanged.

## Acceptance checklist

- Confirm the uploaded CSV originates from the intended Tally company and accounting period.
- Verify every included line is an individual ledger rather than a group subtotal.
- Have a reviewer approve the explicit ledger-to-account mapping outside the browser.
- Retain the original file and independently verify its SHA-256 matches the exported report.
- Resolve every exception before relying on the comparison; matched totals do not prove source completeness.
- Obtain separate CA review and applicable statutory evidence before any certification claim.
