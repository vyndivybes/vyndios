# Managing Director cross-application identity — source verifier

**Authority:** Founder confirmation, 20 November 2026. Company owner: Vāyú Shastr Pvt Ltd. VYNDI OS is an internal platform of this legal entity; VAOS JARVIS is its separate orchestration system.

## Verified architectural facts
VAOS issues its own hardened HMAC-v2 `vaos_session` authentication cookie. VYNDI OS uses its **own** Better Auth user and session tables, with a distinct `__Host-grok-auth.session_token` cookie. Signing into one site **does not automatically sign into the other**, and email equality is not federation.

Independent production read-only evidence before this change showed exactly **one** candidate Better Auth user matching the approved founder login and a pre-existing **admin** role, but **emailVerified=false** and unexpired local session records (which do not establish that the requesting VAOS browser holds any of those sessions). No database role grants or account alterations are authorized.

## Added security contract
VYNDI signed P-256 nonce-checked read action `GOVERNANCE.OBSERVE_MD_IDENTITY` returns only booleans derived from a **fixed** owner email: account uniqueness, verified email status, pre-existing admin role, linked account provider and presence of unexpired session rows. No raw account IDs, session tokens, names, password hashes, provider identities or emails leave the service. The input cannot select a different identity or tenant.

All results always report `HOLD`, `crossPlatformSsoEnabled=false`, `mdAuthenticatedAcrossBoth=false` and `productionWriteAuthorized=false` regardless of the existence of an account or role. A signed service request authenticates the VAOS *service*, not a specific browser or founder. **No SSO is implemented here.**

## Remaining commissioning gates
1. Verify VYNDI Better Auth email ownership via the existing secure sign-in/verification provider; do not silently toggle `emailVerified`.
2. Implement a reviewed federation protocol (OAuth/OIDC authorization-code+PKCE or equivalent) with issuer, audience, short-lived single-use code, redirect allowlist, server-side state+nonce and session rotation before claiming the same interactive identity in both apps.
3. Independently prove a current VYNDI browser session and actual authenticated user binding to the company and pre-existing admin assignment; do not grant roles from an unverified email alone.
4. Preserve maker/checker and supplier/stock/finance operation holds until independently commissioned.

**Never** copy VAOS cookies into VYNDI, share signing secrets, or create VYNDI Better Auth sessions from a plain email or GitHub/ChatGPT declaration.
