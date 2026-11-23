# Governed agent tooling — integration batch 1

Scope: VAOS JARVIS / VYNDI OS development workflow. These are **development-only** facilities, **not an automated deployment**, and do not alter application runtime, database permissions, purchasing controls or external communications.

## Disposition

| Source | Integration | Operational evidence |
| --- | --- | --- |
| Chrome DevTools MCP | Existing isolated local OpenCode MCP entry | Config/test only; live session requires Chrome |
| Google Stitch Skills | Existing governed Stitch skill; remote MCP disabled | HOLD pending auth and free-tier confirmation |
| Modern Web Guidance | New agent-discoverable skill | HOLD on automated scanning until reviewed CLI installed |
| Plannotator | New opt-in disabled MCP entry and review skill | HOLD until local binary and reviewer available |
| Alibaba Open Code Review | New delegation-mode skill | HOLD until local OCR CLI and host agent review |
| Cloudflare Security Audit | New evidence-led audit skill | HOLD for full audit until sandbox, validators, verifier available |

## Setup and authorized execution

- Existing OpenCode config: opencode.json. Chrome DevTools is isolated, without usage statistics or CrUX access. Never attach a personal authenticated browser profile or production secrets.
- Modern Web Guidance: inspect https://github.com/GoogleChrome/modern-web-guidance and choose a reviewed exact release. Upstream commands: modern-web-guidance search "query", and modern-web-guidance legacy-scan . Never run an unreviewed floating npx installer.
- Plannotator: inspect https://github.com/backnotprop/plannotator and install its reviewed binary independently. After local qualification, enable the disabled Plannotator MCP entry for an authorized OpenCode developer session. Configured command: plannotator inbox mcp.
- Code review: inspect https://github.com/alibaba/open-code-review. With a qualified local OCR CLI, use ocr delegate preview --format json --from main, then ocr delegate rule --format json --from main <paths...>. Native mode is intentionally disabled; delegation needs no separate OCR API key but still needs a permitted host agent.
- Cloudflare audit: inspect https://github.com/cloudflare/security-audit-skill. The six-phase audit requires independent verification, valid finding/coverage records and an OS-enforced sandbox; otherwise HOLD.
- Existing stitch-design-workflow remains unchanged; Stitch authentication is independently authorized and not automatically enabled.

## Release and autonomy policy

Agent output cannot authorize business actions. Purchase issuance or an external message still needs explicit **founder approval**. Internal preparation and approved business workflows continue under existing policy. No credentials, paid services or model API tokens are added.

## Evidence and rollback

Run node --test scripts/agent-toolchain-contract.test.mjs scripts/design-tooling-contract.test.mjs (the dedicated PR CI runs both). Run full repository regression and browser acceptance when runtime code changes. Contract tests confirm configuration and skill safety, NOT installed binaries, a complete AI code review or production deployment.

Rollback: revert the branch/PR, remove new skills and disabled Plannotator MCP entry. No database migrations or production secret updates required.
