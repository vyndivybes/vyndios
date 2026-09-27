# VYNDI Main Branch Protection — Required GitHub Ruleset

This file is the repository-side specification for the external GitHub ruleset that must protect `main`.

## Target

- Branch: `main`
- Enforcement: active
- Direct pushes: blocked
- Force pushes: blocked
- Deletions: blocked
- Changes must enter through a pull request.

## Required checks before merge

Require the current repository gates that protect VYNDI business truth and release integrity:

- CI
- Stage D Acceptance Gate
- VIBPE Co-Pilot 2 Deployment Gate
- VIBPE Optimizer Closure Gate
- H2 Backup Restore Recovery Gate
- H3 Performance Load Qualification Gate
- H4 IAM Access Governance Gate
- H5 Governed Integrations Gate
- Stocktake Statutory Controls Gate
- Admin Recovery Centre Gate

## Merge governance

- Require a pull request before merging.
- Require all required status checks to pass.
- Require branches to be up to date before merge.
- Do not permit bypass for routine application changes.
- Preserve emergency administration only through the organization's explicitly controlled break-glass process.

## Repository tripwire

`.github/workflows/main-governance.yml` independently checks every pushed `main` commit for merged pull-request lineage. This is detection, not prevention. The GitHub ruleset above is the preventive control.

## Current connector limitation

The connected GitHub application can read repository protection state but does not expose branch-protection/ruleset administration. Therefore the ruleset must be enabled through GitHub repository administration by an organization administrator.
