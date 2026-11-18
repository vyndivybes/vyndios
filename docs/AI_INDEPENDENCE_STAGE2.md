# Bounded synthetic development route

`POST /api/runtime/ai-development` requires the existing individually assigned
business `approve` permission, same-origin JSON and exactly `{confirm:true}`.
It does not query IBPE, finance, engineering, customer data, memory or RAG.
It calls the same bounded synthetic-only probe contract as VAOS Stage 2.

The two runtime modules in `vendor/ai-independence/` are reviewed copies of
VAOS `platform/ai-independence/{development-probe,gemini-free-adapter}.mjs`.
Keep them byte-identical when changing the contract and run both test suites.
They are server-only imports; do not expose them from client components.

No flag, key, billing, R2 binding or production infrastructure is configured
here. Default runtime status is HOLD. Prerequisites are documented in VAOS
`docs/AI_INDEPENDENCE_STAGE2.md`: reviewed project-key identity, verified
unbilled free tier and quota, <=24h approval evidence, fixed fixture and
durable atomic one-shot reservation/audit before network. The configuration
names retain their `VAOS_` prefix so vendored logic has one contract.
The request cannot provide a prompt, provider, model, classification or tools.
No provider output creates business write authority.

## Existing inference finding

`src/lib/ibpe-copilot.ts` can call `https://api.x.ai/v1/chat/completions`
with `grok-4.5` when `XAI_API_KEY` is present, including governed IBPE context.
That existing path is **not** qualified as free-only by this programme. It
is deliberately not rerouted to Gemini: its context may be confidential.
Review its cost/consent policy and data-egress authorization before claiming
application-wide compliance. This change does not disconnect it or modify
business records, transaction gates, receipts or execution authority.

Workers cannot access a Windows PC's loopback. Cloud-to-local routing needs a
separately authorized and authenticated controlled inference service; the
installed Windows Ollama model is not a VYNDI production backend.

Run `npm run test:ai-independence`, the canonical suite, typecheck and bundle.
Release remains draft/HOLD until exact-head CI, protected review and runtime
qualification. Synthetic mocked responses do not prove live Gemini service,
multimodal capability, learning, mission completion or provider independence.
