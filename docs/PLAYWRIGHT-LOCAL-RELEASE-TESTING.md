# VYNDI Local Release Testing — Playwright

This workflow replaces paid browser-agent dependency for VYNDI release verification.

## What it proves

1. `npm run test:golden-order:core`
   - runs the isolated canonical Golden Order authority test in PGlite;
   - covers confirmed order → production → quality → dispatch → invoice → receivable → collection;
   - retains negative/idempotency/reversal controls in the existing canonical test suite;
   - creates no external supplier or customer side effects.

2. `npm run test:browser:production`
   - uses Playwright Chromium already present in the repository;
   - signs in with an individual VYNDI identity;
   - verifies the protected production route set;
   - checks the Commercial order-entry surface is present;
   - does **not** click business transaction mutation controls;
   - captures screenshots plus `evidence.json` under `.grok/evidence/`.

Together these provide transaction-authority proof plus real deployed UI/authentication proof without TinyFish or another paid browser service.

## Windows PowerShell — recommended

From the repository root:

```powershell
.\scripts\run-vyndi-release-test.ps1 -Email "YOUR-VYNDI-EMAIL"
```

The script prompts securely for the VYNDI password. It does not write the password to the repository or evidence files.

To watch the browser:

```powershell
.\scripts\run-vyndi-release-test.ps1 -Email "YOUR-VYNDI-EMAIL" -Headed
```

To test another deployment:

```powershell
.\scripts\run-vyndi-release-test.ps1 `
  -BaseUrl "https://your-deployment.example" `
  -Email "YOUR-VYNDI-EMAIL"
```

To require a specific deployed source SHA when the target exposes `/api/runtime/release-marker`:

```powershell
.\scripts\run-vyndi-release-test.ps1 `
  -Email "YOUR-VYNDI-EMAIL" `
  -ExpectedSha "FULL-COMMIT-SHA"
```

## Direct npm commands

```powershell
npm ci
npx playwright install chromium
npm run test:golden-order:core
$env:VYNDI_TEST_BASE_URL="https://vyndios.vayushastr.workers.dev"
$env:VYNDI_TEST_EMAIL="YOUR-VYNDI-EMAIL"
$env:VYNDI_TEST_PASSWORD="YOUR-PASSWORD"
npm run test:browser:production
Remove-Item Env:VYNDI_TEST_PASSWORD
```

Prefer the PowerShell wrapper because it prompts for the password securely and clears the temporary environment variables after the run.

## Safety boundary

The production Playwright smoke is intentionally read-only after login. A full production transaction should not be automated until the team explicitly authorizes creation and cleanup/reversal of RC business records. The canonical Golden Order test already exercises the full transaction authority chain in an isolated database.
