# PR #23 Guide component acceptance

Source baseline: e23cb976f00e80c8641b799fa11dcb4baf31523c plus the footer layout fix in this commit.
Tested component blob: 713f4c441aea14b24499fc9fe7134a883971e38d.

The exact GuidedWorkPanel, canonical WORKSPACE_NAVIGATION, real page-access/page-metadata, guided-work, utils and repository styles were bundled with esbuild and Tailwind, then exercised using Chromium/Playwright. React Router hooks were replaced by a fixture pathname (/command) and a navigation recorder. This is component acceptance, not authenticated production smoke or proof of server authorization.

| Viewport | Role | Authorised destinations | Result |
| --- | --- | --- | --- |
| 390 × 844 | admin | 55 | PASS |
| 768 × 1024 | admin | 55 | PASS |
| 1440 × 900 | admin | 55 | PASS |
| 390 × 844 | viewer | 14 | PASS |

All four exercised launcher opening, global catalogue, no-match search and reset, scope switching, Ask VYNDI event delivery, Escape close and feature-navigation request. Viewer catalogue excludes the admin workspace. No uncaught browser errors or horizontal overflow occurred. Dialog geometry fits the viewport. The authority-notice text is fully within the panel bounds.

The original layout failed the footer visibility assertion at 390 × 844. Keeping header/navigation/footer fixed in a flex column while allowing the catalogue body to shrink and scroll resolves the clipping. The same assertion and interactions passed after the fix. Desktop and mobile screenshots were visually inspected.

Screenshots: [mobile](mobile.png), [tablet](tablet.png), [desktop](desktop.png), [mobile viewer](mobile-viewer.png).

Regression repair: 99 affected local checks passed without skips; the additional TypeScript schema-parity suite passed 5/5. Full canonical CI/build and deployment are independent gates and must be confirmed for the final branch SHA.
