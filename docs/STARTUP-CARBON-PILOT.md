# Startup carbon-frame pilot — planning intent

Planning basis: founder instructions on 10 October 2026. These targets are not orders, inventory transactions or a manufacturing release.

| Target | Quantity | Due |
| --- | ---: | --- |
| Size S | 2 | 10 January 2027 |
| Size M | 1 | 10 April 2027 |
| Size L | 1 | 10 April 2027 |

The design may change over the next month. Review the candidate design around 10 November 2026, then reassess tooling, materials, supplier lead times and validation against these targets. No final model, variant or engineering revision has been authorized by this planning note.

## Product identity and traceability

Use the existing model/family and commercial variant. Frame size is `configuration.frameSize` on an order/build, not another product identity or a separate ledger. A batch has one configured size; record mixed-size demand as separate orders/batches under the same model and variant. Components, materials, tooling and serial traceability remain in their existing ledgers. A size value is a requested configuration, not evidence that its geometry or tooling is released.

Historical orders without size remain unspecified. Do not assign a default size or rewrite historical quantities. Commercial configuration flows to the existing job card; stock identities and released mappings remain unchanged.

## Design-change handling

Record a proposed change in the existing Engineering change-request workflow, linked to its current baseline and intended model/variant. Maintain candidate geometry, material, layup, tooling and BOM evidence there. Keep uncertain cost, weight and lead-time impacts explicit rather than inventing values.

Approve and release the next engineering/BOM revision only after the required review. Existing approved job cards retain their frozen BOM and sales-order revision; affected builds require the existing controlled hold/revision-impact process. Draft designs and planning targets do not authorize procurement or physical manufacture.
