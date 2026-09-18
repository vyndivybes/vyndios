# VYNDI V1 H4 IAM / Segregation of Duties / Access Certification — Rev 1

**Parent baseline:** `75cad75e779570e02960eb6a73ebd508cf7ef653`  
**Scope:** privileged identity administration, least privilege, maker/checker role governance, break-glass control and periodic access certification.

## Access model

VYNDI retains one persisted application role per individually authenticated Better Auth user. The one-row-per-user primary key in `vindy_user_roles` is the primary application SoD boundary: one identity cannot simultaneously accumulate Finance + Operations + QA roles.

Existing route/domain permission policies remain unchanged. H4 governs **who may change access**; it does not broaden operational permissions.

## Role changes

Routine changes follow:

`Admin maker → pending role request → different Admin checker → applied role`

Controls:
- the request records previous role, requested role, reason, maker and timestamp;
- raising a request does not change current access;
- one pending role request is allowed per target user;
- the request maker cannot approve or reject their own request;
- approval re-checks that the target's current role has not changed since the request;
- rejected and approved decisions remain in access history;
- the configured bootstrap administrator cannot be downgraded.

## User provisioning

Non-bootstrap users are provisioned initially as **Viewer**. If the administrator selects a more privileged role during creation, VYNDI creates a pending maker/checker role request rather than silently granting the role.

A configured bootstrap-admin email is provisioned/maintained as Admin by the existing bootstrap rule.

## Break-glass

Break-glass exists only to avoid administrative deadlock when no second administrator is available.

- server authorization restricts break-glass to a configured `VINDY_ADMIN_EMAILS` identity;
- an explicit reason is mandatory;
- the role-change record is marked `emergency_override=true`;
- an immutable `role_change_emergency` event is written;
- every emergency override must be reviewed in the next access certification.

Break-glass is not a normal alternative to maker/checker.

## Privileged identity event history

H4 records append-only events for:
- account provisioning;
- role request / approval / rejection;
- emergency role application;
- administrator password reset;
- account deletion;
- access certification.

Access evidence must never contain passwords, password hashes, bearer/session tokens, refresh tokens or credential secrets.

## Session review

Access certification includes the active Better Auth session count per user. VYNDI flags more than three active sessions as an access-review exception, aligned with the existing session-concurrency policy.

H4 does not expose session tokens or IP/user-agent detail in certification evidence.

## Access certification

An administrator captures an immutable snapshot containing:
- users and assigned role;
- last role-update timestamp;
- active-session count;
- pending role changes;
- current access exceptions;
- confirmation that single-role and maker/checker controls are active.

Minimum review cadence:
- quarterly;
- after any break-glass role change;
- after a security incident;
- after material organizational / role-policy changes.

Certification is evidence, not automatic remediation. Exceptions must be resolved through their owning identity/access workflow.

## Current certification exceptions

H4 flags:
- user without an assigned role — critical;
- configured bootstrap administrator not holding Admin — critical;
- more than three active sessions — warning;
- pending role-change request — warning.

## Account deletion

- the signed-in administrator cannot delete their own active account;
- configured bootstrap administrators cannot be deleted;
- users with pending role-change requests cannot be deleted until those requests are resolved;
- deletion is recorded before the identity is removed.

## External identity-provider maturity

VYNDI currently uses Better Auth application identities and application RBAC. Enterprise SSO, IdP-enforced MFA, SCIM lifecycle automation and provider-level conditional access are future organization/infrastructure capabilities and are not falsely claimed by H4.

## Assurance

H4 is complete only when:
- fresh database migration succeeds;
- maker/checker self-approval is rejected;
- independent checker approval changes the role;
- break-glass is explicitly flagged;
- access events and certifications prove append-only;
- UI/typecheck/build/tests remain green;
- H1, H2, H3 and existing transaction/recovery gates remain green.
