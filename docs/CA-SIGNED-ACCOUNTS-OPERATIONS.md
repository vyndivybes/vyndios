# CA-Signed Accounts Register — Operating Controls

This is a register of certificates and audit reports **actually issued and signed by an independent practising Chartered Accountant**. The application cannot become an ICAI-accredited Chartered Accountant, issue a statutory opinion, generate a valid ICAI UDIN, or certify its own books.

## Operator procedure

1. Prepare the company's posted accounts using the existing Accounting Workbench and Financial Statements. Resolve posting exceptions, bank and GST discrepancies, period close, source documentation and balance differences.
2. Appoint an eligible independent practising CA for the appropriate statutory assignment. The CA independently reviews source books, evidence and final signed PDF and issues any applicable certificate or audit report.
3. The CA obtains the UDIN through **ICAI's own portal**, if required for the particular signed document. Never generate a sample or invented UDIN.
4. In **Finance → CA-Signed Accounts Register**, an authorized maker enters the actual CA name, six-digit membership number, UDIN, signing date, reporting period and retained signed-document reference, and selects the actual signed PDF. Its SHA-256 is calculated entirely in the browser; the PDF is **not uploaded**.
5. A **different authorized checker** inspects the original document and checks the UDIN manually with ICAI's portal. Enter the six-digit membership number observed, the finding, and a retained evidence reference. The system enforces maker/checker separation and appends immutable verification events.
6. Preserve the signed original PDF, its verified provenance, the portal observation and evidence reference outside the database register. Compare SHA-256 against the immutable register before relying on the recorded document.

## Meaning of statuses

- `recorded_unverified`: document details recorded; no independent portal observation.
- `portal_check_recorded`: independent human checker **claims** that a matching portal result was seen. No API confirmation; the application has **not** established statutory certification independently.
- `disputed`: the checker recorded that UDIN was missing or inconsistent. Do not rely on the certificate.

No state is named `CA-certified`. The actual legal status derives solely from the practising CA's signed original, applicable laws, UDIN status and genuine supporting audit work.

## Security and data boundaries

- Viewing requires the existing finance role; recording requires finance edit; verification requires finance approval and a different user.
- Certificate issuer, UDIN and signed-document digest are immutable after initial entry.
- Verification events are append-only; a checked certificate cannot be silently changed into an approved one.
- The record contains *the hash supplied by the browser*, not the signed original PDF or a verified digital-signature chain.
- Uploaded signed PDF stays on the operator's device. The system does not store its bytes or independently validate its cryptographic signature.
- This does not integrate with ICAI via API, initiate filings, post general-ledger entries or substitute for a CA's independent assessment.
- Enabling the register requires the forward-only migration `0194_ca_certificate_evidence_register.sql`. Restrict data access and take a controlled backup before running migrations.

## Independent acceptance

Use an authorized example from the appointed CA (not fabricated CA credentials) to verify role restrictions, signed-document provenance, UDIN observation, expected period and source financial statements. Have the appointed CA confirm whether the accounting practices and disclosures are suitable for the specific certificate and reporting framework.

## Authoritative references

- ICAI guidelines: https://www.icai.org/post/15863
- ICAI UDIN information: https://udin.icai.org/
- ICAI UDIN member manual: https://udin.icai.org/pdf/ICAI-DigiCA%20UDIN%20Portal%20Manual_Updated.pdf
