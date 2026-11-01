# Theme tooling

Run from mourn-desktop (Node 22+; probe uses native fetch/WebSocket):

- `npm run theme:audit` — descending per-file debt counts; add `-- --json` for machine output.
- `npm run theme:guard` — fail on per-file total OR individual literal growth against `scripts/theme-baseline.json`. New files get zero budget. Moving debt between files or swapping colors cannot hide growth.
- `npm run theme:test` — runs `node --test scripts/theme-tools.check.mjs`: isolated temporary-file regression tests, including deliberate new Vue colors. The `.check.mjs` name keeps these Node tests out of Vitest discovery.
- `npm run theme:sweep` — dry-run only; lists proposed replacements and manual triage. `-- --write` explicitly opts into writes. Do not use on production sources until the P1 zero-diff gate is accepted. Even exact color equality does not establish correct semantic ownership.
- `npm run theme:probe -- --out /tmp/styles.json --url http://localhost:9001` — attach to an existing Chrome CDP session on port 9222. Optional `--cdp` changes discovery endpoint. Does not launch a browser, navigate, authenticate, or start servers. Missing checklist surfaces fail with a nonzero exit and explicit missing selectors, rather than a misleading complete baseline. Capture appropriate routes separately. Review the chat-row selector against the live DOM.

The baseline is literal debt in the CURRENT working tree, not a historical visual baseline. Never automatically regenerate it in CI. To deliberately ratchet it after reviewed removals, redirect `node scripts/theme-audit.mjs --json` to a temporary file, inspect the diff, then replace the baseline. Baseline/allowlist changes require review.

Scope: Vue, SCSS and CSS under src, including template/script strings and inline styles in Vue. Block/HTML comments are ignored. Hex (3/4/6/8 digits) and non-nested rgb/rgba calls are measured, not named colors, hsl/oklch, standalone TS, generated utilities, public/native surfaces, or SVG assets. This is a lexical audit, not a CSS parser: hex-like IDs/strings can be conservative false positives. Arbitrary RGB expressions are triage-only. No broad GL/scene exemption is granted without inspecting and documenting specific occurrences. Profile SCSS is excluded entirely; brand red has a bounded, reasoned exception.

Sweep only handles entire simple color declaration values in style blocks/CSS/SCSS, with a unique exact default-token match (3-digit hex expanded). Duplicate token values are ambiguous and left unchanged, as are gradients, Sass variables, shorthands, URLs, arbitrary utilities, script/template strings and alpha colors. The default token table is read without executing TypeScript. Profile SCSS is never written.

Initial measurement: raw 1,688; profile excluded 89; bounded brand exemption 1; guarded 1,598 in 77 nonzero files. This differs from the plan's historical 1,682 because this is a modified working tree and the scanner explicitly masks comments and includes 4-digit alpha hex. It is not evidence that the visual gate passed.

Desktop `build` and `build:spa:desktop` run the guard before compiling. Tests need no new dependencies. The CDP probe requires a running debug browser; no visual capture baseline is supplied by these scripts.
