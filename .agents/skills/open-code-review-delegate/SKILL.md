---
name: open-code-review-delegate
description: Review branch changes using Alibaba Open Code Review's local delegation pipeline without a separate LLM API key.
---

# Open Code Review — delegation mode

Upstream: https://github.com/alibaba/open-code-review (Apache-2.0).
The ocr CLI is optional and must come from a reviewed, version-pinned upstream release on an authorized developer machine. Native OCR mode is not enabled; no separate API key is required for its delegation CLI, although the host agent needs permitted model access.

1. Inspect the diff and data-egress rules. Never send credentials, business records or customer data to a third-party model.
2. If ocr is available, run ocr delegate preview --format json --from main to enumerate all changed files. Run ocr delegate rule --format json --from main <files...> to resolve applicable rules. Have the host agent actually review those diffs.
3. Report reviewed files, potentially affected callers, authorization effects, tests and uncertainties. The delegation CLI does not itself perform LLM code review.
4. If the binary or host model is absent, mark **HOLD** and use human PR review plus deterministic tests; do not claim an Open Code Review PASS.
5. Include auth, supply chain, data provenance, Cloudflare bindings and business writes in the review.
6. Merge needs green CI and required approval. Purchase issuance and external communications separately require founder approval.
