# Founder email verification — zero-cost Cloudflare stage

Decision owner: Managing Director, Vāyú Shastr Pvt Ltd, 20 November 2026.

## Implemented
- Native **Better Auth email verification**, 15-minute one-time link, existing user only; no new account, no password/token stored or exposed by UI.
- The delivery adapter is **Cloudflare Workers Email Service**, free to verified recipient addresses. It requires an owner-approved `send_email` binding named **`VYNDI_VERIFICATION_EMAIL`**. Until the binding exists, the adapter **fails closed** with `VERIFICATION_EMAIL_DELIVERY_UNAVAILABLE`.
- A *separate*, explicit **Send verification link** button on the VYNDI login page, scoped to existing founder email **shyamsundhar1982@gmail.com**. The response is not an account verification receipt; an actual email link must be opened by the mailbox holder and validated by Better Auth.
- The email link can ONLY be `https://vyndios.vayushastr.workers.dev/api/auth/verify-email?token=...` (optional relative callback `/login`). No user-supplied URL, origins, external callbacks, session grants, impersonation, finance/store writes or arbitrary recipients.
- **Do not set `requireEmailVerification:true` yet.** That would lock out the pre-existing founder account before a sending provider is accepted. No automatic login on verification.

## Cloudflare platform commissioning gate

As of 20 Nov 2026, the connected Cloudflare account shows a verified Email Routing destination for the founder Gmail address. This is **NOT** the same thing as VYNDI Better Auth `emailVerified`: the VYNDI database still has `emailVerified=false`.

The connected Cloudflare account can manage Workers and Email Routing destinations, but its access to Email Sending endpoints returned **HTTP 401, code 2036 Unauthorized**. **No outbound Cloudflare Email Service binding exists** yet on the VYNDI Worker. Do not advertise that mail delivery has been qualified.

The Managing Director must authorize Cloudflare Email Sending within the connected account (free sending to verified destinations; do not enable a paid sending plan). Configure the domain **vayushastr.com** as an approved sending domain if the provider requires it, verify DKIM/SPF, and then deploy this restricted Wrangler binding:

```json
"send_email": [{
  "name": "VYNDI_VERIFICATION_EMAIL",
  "destination_address": "shyamsundhar1982@gmail.com",
  "allowed_sender_addresses": ["no-reply@vayushastr.com"]
}]
```

This binding is **not activated in source** until Cloudflare verifies sender authorization and the production deployment can be independently qualified; doing otherwise can break a healthy Worker deploy.

## Acceptance tests
1. Confirm `VYNDI_VERIFICATION_EMAIL` binding is active, correct domain authorized, and zero-cost send quota/verified-destination status.
2. Test one founder-only Better Auth email request and verify it reaches Gmail; confirm token itself is never logged. Check invalid origin, missing token, wrong recipient and absent binding fail closed.
3. Founder opens the **real** emailed link, not a token copied into chat. Better Auth consumes token once and updates `public."user"."emailVerified"` for the existing account.
4. Independently query only non-secret account status: 1 unique account, 1 admin role, `emailVerified=true`; do not infer cross-app SSO, identity by email equality or upgrade business-write permissions.
5. Cross-app secure SSO with PKCE/state/nonce remains a distinct commissioning phase.

References:
- Better Auth: https://better-auth.com/docs/concepts/email
- Cloudflare Worker Email Sending: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- Free verified destination sending: https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/
