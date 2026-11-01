# Finance F3 — Native TallyPrime XML Response Inspection

## 5P release scope

- **Plan:** Process TallyPrime's documented `Trial Balance` XML response before considering any live connection or reconciliation.
- **Prepare:** Verify the response schema against TallyPrime's published `DSPACCNAME`, `DSPDISPNAME`, `DSPACCINFO`, `DSPCLDRAMTA` and `DSPCLCRAMTA` example.
- **Proceed:** Create an isolated branch from Finance F2's source-qualified head. F1/F2 remain outside production.
- **Perform:** Implement an offline, bounded, fail-closed XML response inspector.
- **Persist:** Add negative-path tests and run the existing Finance qualification CI workflow.

## Implemented

- `inspectTallyTrialBalanceXml(xml)` inspects a **strict supported subset** of TallyPrime's native display report, without network calls or dependencies.
- XML must have exactly one `ENVELOPE`, balanced tags and well-formed attributes; rejects processing instructions, DTD, user-defined entities, malformed XML and oversized responses.
- Rejects `STATUS=0`, `LINEERROR`, orphaned report names/amounts, duplicate display names and unsupported amounts.
- Explicitly **preserves signed display amounts**. Example documentation contains negative debit values; treating those as ordinary nonnegative ledger debits would be unsafe.
- Returns `status=inspection_only`, `comparableLedgerRowsReady=false`, `companyVerified=false`, `periodVerified=false`, `caCertified=false`.

## Deliberate qualification boundary

The published Trial Balance response can contain **account-group aggregates** (for example, *Current Liabilities* and *Current Assets*) rather than validated individual ledger rows. Consequently, F3 **must not** automatically feed these display rows into the F1 Tally-to-VYNDI ledger comparator. A later feature must obtain and attest leaf-ledger coverage, the exact company/period, source provenance and approved mappings first.

## Before a live F4 connector

1. Obtain a safe dedicated test-company TallyPrime instance and a private authenticated connector. Never publicly expose its typical port 9000.
2. Independently validate company selection and period against both the TallyPrime UI and exported source.
3. Add versioned fixtures from an actual company report, with explicit consent and removal of any unnecessary personal information.
4. Identify genuine ledger-grain data, groups, signs, opening/closing movements and report totals; block aggregation double-counting.
5. Run full CI and controlled integration tests; require independent CA review, documented exception resolution and no unauthorized accounting mutations.

## Tests

`node --test scripts/tally-native-xml-response.test.mjs`

## Official Tally references

- https://help.tallysolutions.com/sample-xml/
- https://help.tallysolutions.com/xml-integration/
- https://help.tallysolutions.com/building-tunnel-based-connectivity-for-tallyprime-integrations/
