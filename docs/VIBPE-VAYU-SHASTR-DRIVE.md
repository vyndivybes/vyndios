# VIBPE Vāyu Shastr Drive Corpus

## Registered source

- User-supplied parent link: `11H0Jv-9KE8AXyQ2XM8yE22U1HHoCNb5i`
- Resolved inner corpus folder: **VAYU SHASTR**
- Governed root folder ID: `1QDwLydKu5tQthElxTGCT4BO2AP5xXkKS`
- VIBPE source ID: `VIBPE-SRC-VAYU-SHASTR-DRIVE`
- Default authority: advisory/reference

The user-supplied parent link contains the VAYU SHASTR folder; VIBPE indexes the inner folder rather than the wrapper folder.

## Source classes

### controlled-reference
Paths under:
- `FINAL DOSSIER`
- `VAYU_MASTER_ENGINEERING_PACKAGE_REV1`

These rank higher during retrieval but remain advisory until promoted by an owning governed workflow.

### reference
Supplier/Toray material, TANSAM/TANCAM communication, RFQ, presentation and other working/reference material.

### legacy-working
Architecture iterations and files whose names indicate draft, rough, sample, copy, old, preliminary or Rev 0 status. These are down-ranked and assumption-like content remains unresolved.

## Secret exclusion

VIBPE never indexes the folder:
`12D8SfbcnX9y5E9oOa614SE7BUYBbRQEK` — **google client secret for shyamsundhar1982**.

The crawler also excludes names matching credential/password/private-key/API-key/OAuth/access-token/refresh-token patterns.

## Supported content

Content indexing currently supports:
- native Google Docs;
- native Google Sheets via CSV export when available;
- plain text, HTML, Markdown, CSV, JSON, XML and SVG text.

Other binaries such as PDF, DOCX, ZIP, raster images and unsupported formats are stored as metadata-only references. VIBPE knows they exist and where they are, but must not imply their contents were parsed.

## Refresh

- Manual: Knowledge → **Refresh Vāyu Drive**
- Automatic: VIBPE Co-Pilot performs a best-effort refresh when the source is older than 12 hours.
- OAuth/network failure is non-blocking; VIBPE continues with the last successful corpus.

## Authority

Drive corpus evidence cannot silently overwrite engineering master data, BOM, inventory, supplier master, cost authority, approved plans, transaction state or accounting actuals. Master-data promotion remains a separate controlled action.


## Toray material-validation gate

Toray supplier material evidence is governed as a controlled engineering input, not as an automatic production authority.

Before a Rev-1 laminate material basis may move from **provisional** to **supplier-validated**, the engineering record must capture:

- frozen commercial Toray prepreg/material-system identifier;
- fibre basis;
- supplier-backed fibre areal weight (FAW);
- supplier-backed resin content;
- cured ply thickness (CPT) validated against Toray supplier data and/or the Toray Ply Thickness Calculator;
- Toray calculator source URL and traceable calculator evidence record ID;
- calculator verification timestamp;
- supplier datasheet/reference used for the calculation.

Authoritative Toray supplier sources:

- Datasheets: `https://www.toraytac.com/resources/datasheets`
- Engineering calculators: `https://www.toraytac.com/resources/Calculators`

The datasheet page is the preferred manufacturer source for identifying the commercial material system and its published supplier properties. Calculator output must be traceable back to the selected material datasheet/reference; calculator evidence must not be treated as a substitute for the underlying supplier datasheet.

A successful supplier-material gate permits only **supplier-validated engineering use**. It does **not** release ply count, laminate strength, frame structure or production. Downstream release continues to require laminate allowables, manufacturing-process controls, FEA/test correlation, coupon/subcomponent validation and applicable ISO 4210 frame/fork validation.

The current provisional ply-thickness assumption must therefore remain explicitly provisional until the selected Toray commercial prepreg system is frozen and this evidence gate is satisfied.
