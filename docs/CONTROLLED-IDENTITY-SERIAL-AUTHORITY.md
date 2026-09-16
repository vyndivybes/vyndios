# VYNDI Controlled Identity & Serial Authority

**Controlled source:** VĀYÚ DOC 04 · Product, Component & Asset Identity Scheme · Rev 1.2 · 2026-09-16  
**Implementation migrations:** `migrations/0076_controlled_identity_serial_authority.sql`, `migrations/0077_require_confirmed_launch_identity.sql`, and `migrations/0078_goods_receipt_identity_capture.sql`

## 1. Finished VĀYÚ products

New production identities use:

`MODEL-MMYY-NNNN`

Current controlled model codes:

| Family | Code | Format example |
| --- | --- | --- |
| Longitude | `LON` | `LON-0926-0001` |
| Latitude | `LAT` | `LAT-0926-0001` |
| Altitude | `ALT` | `ALT-0926-0001` |

The `0926` values above are **format examples only**. They do not declare September 2026 to be the official launch month for any model.

`MMYY` is the formally authorised model launch month/year, not the unit manufacture date. VYNDI blocks new canonical product serial issuance until an authorised user records the official launch MMYY for that model. Once the first canonical serial has been issued, the launch code is frozen and cannot be silently changed.

The Production traveller server function no longer requires a client-entered serial. After official launch MMYY authorisation, the database generator is the authority for new VYNDI production serials.

## 2. VĀYÚ-controlled components and configurable options

For components requiring individual serialization:

`FAMILY-VARIANT-MMYY-NNNN`

Examples include:

- `HBR-400-0926-0001`
- `STM-090-0926-0001`
- `CRK-170-0926-0001`
- `WST-C45-0926-0001`
- `TYR-7035-0926-0001` when an individually serialized tyre is justified

For component examples, MMYY denotes the controlled release month/year of the approved component or variant family, not necessarily the manufacture date of the individual physical unit.

The visible code is deliberately short. The controlled Item Master remains authoritative for complete material, dimension, interface, supplier, model-compatibility, revision and approved-substitution detail.

## 3. Purchased equipment, spares, tools, assets and ledger items

Existing manufacturer/supplier identities are never replaced:

- manufacturer / brand
- OEM model number
- OEM part number
- OEM serial number
- supplier SKU
- supplier batch / lot
- invoice / GRN
- warranty reference
- calibration reference

VYNDI adds a separate internal reference for cross-ledger control:

- `AST-NNNNNN` — capital / office asset
- `EQP-NNNNNN` — production / test equipment
- `TOL-NNNNNN` — tool
- `SPR-NNNNNN` — purchased spare
- `CON-NNNNNN` — consumable
- `ITM-NNNNNN` — generic purchased item

The system must never synthesize a fake OEM serial merely to fill a field.

### Receiving / GRN workflow

The `/command/receiving` form is the operational capture point for purchased identity. It records the GRN and the supplied external identity in one atomic database operation. Operators can record traceability class, VYNDI internal class, manufacturer, brand, OEM model, OEM part number, OEM serial, supplier SKU, supplier lot/batch, invoice reference, warranty reference and calibration reference.

- **Accepted receipt:** external identity is stored and a separate VYNDI internal reference is materialised against the accepted inventory movement.
- **Quarantine:** external identity remains attached to the GRN, but no inventory identity is issued while the material is outside stock.
- **Quarantine later accepted:** the saved external identity is carried forward automatically and the VYNDI internal reference is materialised at acceptance.
- **Rejected receipt:** external identity remains as receiving/audit evidence; it is never presented as accepted inventory.

The receipt and identity register shows the VYNDI reference alongside the retained OEM serial or supplier lot so operators do not confuse one namespace with the other.

## 4. Traceability classes

- **A — Individual serial:** safety-critical, high-value, calibrated, warranty-sensitive or configuration-critical unit.
- **B — Lot/batch:** group traceability is sufficient.
- **C — Quantity only:** low-risk consumable where neither individual nor lot traceability is required.

## 5. Identity layers

Every controlled record separates:

1. **Item / Part / SKU** — what it is.
2. **Revision** — which engineering configuration.
3. **Individual serial** — which exact physical unit, when applicable.
4. **Lot / batch** — which production or receipt group, when applicable.
5. **Immutable VYNDI UUID** — database identity independent of all visible references.

## 6. Genealogy

`vyndi_identity_genealogy` stores effective-dated parent/child relationships and therefore supports both:

- **as-built configuration**, and
- **as-maintained configuration** after replacements, removals or upgrades.

A bicycle keeps the same finished-product serial when a component is replaced; the genealogy changes instead.

## 7. Legacy reconciliation

Historical identities are not renumbered. Existing traveller serials are registered against an immutable identity UUID. Non-canonical historical formats are retained as aliases, including the former:

- `VAYU-YYMMDD-XX-####`
- `VYNDI-<MODEL/TIER>-<HASH>-<NNN>`

`vyndi_identity_reconciliation_report` classifies each traveller as `CANONICAL`, `LEGACY_RETAINED`, `MISMATCH` or `UNREGISTERED`.

## 8. Inventory reconciliation

The identity extension is attached to the existing Master Inventory / canonical receiving authority; no duplicate stock ledger is introduced. `vyndi_inventory_identity_register` exposes the internal reference and preserved OEM/supplier identity together. `vyndi_goods_receipt_identity_register` provides the receiving-side view, including quarantined and rejected identity evidence that is not yet part of stock.

## 9. Governance rules

- New Production serials are generated server-side.
- A model's official launch MMYY must be explicitly authorised before canonical serial issuance is enabled.
- Visible identities use uniqueness controls.
- Historical serials are immutable.
- OEM identities are preserved verbatim.
- Launch MMYY freezes after first canonical issuance.
- Serial namespaces stop rather than silently widen when their controlled sequence width is exhausted.
- GRN + external identity capture is atomic.
- Quarantine cannot create accepted-stock identity before disposition.
- Identity corrections must be auditable and must not rewrite historical genealogy silently.
