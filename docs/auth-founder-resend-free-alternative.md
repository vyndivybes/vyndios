# Founder email verification — Workers Free without Cloudflare Email Sending

**Decision (20 Nov 2026)**: The Managing Director's Cloudflare Email Sending dashboard requires **Workers Paid**. That service must NOT be enabled: zero-cost policy applies. The earlier Cloudflare delivery recommendation was not feasible on this account.

## Implemented no-cost alternative: Resend Free HTTP API
- VYNDI OS keeps Cloudflare **Workers Free** and native Better Auth one-time token verification.
- When no Cloudflare Email Sending binding exists, the server can call `POST https://api.resend.com/emails` using the secret **`VYNDI_RESEND_API_KEY`** from its Cloudflare Worker environment.
- Always targets only the existing Managing Director account (no arbitrary recipients), uses sender **`VYNDI OS <no-reply@vayushastr.com>`**, a canonical Better Auth verification URL, 15-minute token expiry, a 10-second network timeout, deterministic message idempotency and generic error responses without credential or token leaks.
- The app does **not** auto-mark the email verified, issue VYNDI sessions, enroll new users, elevate VAOS authorization or enable business writes.
- Without a valid secret, endpoint fails closed with the existing delivery-unavailable status and the login screen explains that a free sender is not yet configured.
- Existing Cloudflare `send_email` path remains supported only if separately authorized (currently unavailable).

## Owner-only external setup (no billing details or secrets in chat)
1. Open https://resend.com/ and choose **Free ($0)**, keeping automatic overages / pay-as-you-go disabled. Free transactional allocation currently lists **3,000/month**, capped at **100/day**; always check live terms before enabling.
2. In Resend **Domains**, add **vayushastr.com**, select **sending**, follow the **exact DNS records shown by Resend**. Your domain is already hosted on Cloudflare; add DKIM/SPF/MX entries as required but **do not overwrite Google Workspace MX or existing SPF**. A dedicated sending subdomain may be preferable to avoid interference, in which case update the sender address in code and requalify before using.
3. Select **Verify** in Resend and confirm the domain is accepted for sending.
4. Under Resend **API Keys**, create a **sending-only, domain-scoped** key. Set the key as a **secret** called `VYNDI_RESEND_API_KEY` on the production **vyndios** Cloudflare Worker. Do not paste it into the chat, repository, screenshots or plaintext Cloudflare variables.
5. Redeploy/restart the existing Worker if required to pick up the secret. Sign in to `https://vyndios.vayushastr.workers.dev/login` and choose **Send verification link**. Check spam/promotions. Open the mail in Gmail; never share the URL/token in chat.
6. Independently verify that `public."user"."emailVerified"` is `true` for exactly **one** existing founder identity and that its admin role remains unchanged. No SSO or source writes become automatically authorized.

## Fail-closed qualification
Tests cover unknown/duplicate recipients, arbitrary token callback origins, missing keys, bad keys, provider 403/429 errors, missing receipts, idempotency reuse and no secrets in client-facing errors.

**Attention:** The deployment can be GREEN while live email delivery remains **HOLD** until the owner registers the separate $0 provider, authenticates the sending domain and stores the API secret in Cloudflare. The assistant cannot create the external Resend account or secret without an existing authorized integration.
