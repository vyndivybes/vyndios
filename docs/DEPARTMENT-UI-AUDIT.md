# Department placement and overflow audit

Status: source audit and initial edits only; browser rendering UNVERIFIED.

## Findings and disposition
| Surface | Evidence | Disposition |
|---|---|---|
| Manufacturing | AssetMaintenancePanel rendered inline between planning counts and manufacturing-control register | Separate existing maintenance controls into a labelled expandable section; retain canonical route and loader. Does not reduce data loading yet. |
| People & Office | Cost register opens by default; register tables have 1050–1150px minimum widths | Collapse cost register initially; bound existing horizontal-scroll regions and make them keyboard focusable. Wide table redesign and inline editors remain outstanding. |
| Operations | Serial allocation label has 240px minimum width; allocation badges cannot wrap | Use flexible minimum width, mobile full-row basis and wrapping badges. |
| Quality | Long IDs and references in fixed flex rows | Permit wrapping and shrinkable cards. Render with long fixtures before qualification. |
| Operations quality summary | Read-only release/NCR counts support dispatch decisions, full controls linked to Quality | Relevant cross-department summary; preserve. |
| Shared Panel header | Print/export button cannot shrink next to heading | Review small-width header wrapping across registers before qualifying UI. |
| People audit table | Displays role while backend now records individual identity | Add individual identity display during HR record redesign. |
| People tooling classification | Office-assets form permits manufacturing_tooling | Trace accounting/asset ownership before moving; avoid introducing duplicate asset authorities. |

## Placement rules for remaining implementation

Quality owns inspection, NCR/CAPA and release entry. Operations consumes release/hold evidence.
Maintenance owns work orders and service history; production consumes equipment availability.
HR owns people events and payroll inputs; Finance owns posted expenditure and accounting.
Tax registers and funding records live under existing Finance ownership.
Audit findings and recovery evidence remain specialist governance surfaces.
Cross-department pages show relevant summaries and links, not duplicate editing forms.
No new top-level route, renamed route or changed route permission was introduced in this cleanup.

## Remaining audit

Inspect Finance, Taxation, financing, Audit, recovery, sidebar/search metadata and VIBPE navigation.
Inspect record form fields, hidden/responsive CSS and route-level access before reorganization.
Review deep-link behavior, print output and default expansion state.
Replace overly wide inline mobile editors where needed without hiding required fields.

## Candidate browser acceptance

At 360px, 390px, 768px and desktop widths, check:
- no document-level horizontal overflow;
- long IDs, names and evidence references do not expand page width;
- intentional ledger scrolling stays inside the labelled region and works with keyboard;
- forms, actions, error/status messages and print controls stay readable and reachable;
- maintenance section opens/closes and retains inputs;
- collapsed cost register remains discoverable;
- navigation/deep links and authorised save/reload workflows work;
- browser console has no new uncaught errors.

No screenshot, browser smoke, production build or deployment evidence exists for these changes yet.
