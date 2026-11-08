# Reviewed GLib compatibility backport

Tauri's GTK3 stack resolves `glib 0.18.5`. Its `^0.18` API requirement cannot be
satisfied by the advisory's fixed `0.20` release. This directory retains the
published `0.18.5` crate with the upstream `VariantStrIter` safety correction.
It is not an upstream `0.18.6` release and does not claim one exists.

- Original crate: https://static.crates.io/crates/glib/glib-0.18.5.crate
- Original SHA-256: `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`
- Original crate revision: `42b9caf98e03ded086362d9653ca58fe94dc8658`
- Fix: https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34
- Advisory: https://rustsec.org/advisories/RUSTSEC-2024-0429.html
- GitHub advisory: `GHSA-wrw7-89jp-8q8g`

Only `glib/src/variant_iter.rs` differs from the published crate: the pointer
binding is mutable and the C out-parameter receives `&mut p`, not `&p`.
`glib-variant-str-iter.patch` preserves the original upstream patch.
`glib.provenance.json` records the source and SHA-256 of every vendored file.
Retain upstream authorship, package metadata and the MIT license in `glib/LICENSE`.
The Mourn project license does not replace those terms.

The root Cargo manifest uses an explicit path patch. Flatpak's source generator
admits only that reviewed local package and its pinned provenance; changed,
missing, extra or symlinked source files, unexpected local packages and a
reintroduced registry GLib fail validation. `.gitattributes` preserves exact
vendored bytes on all platforms. Review the full tree and update the provenance
pin deliberately if the backport changes.

`src-tauri/tests/glib_variant_iter.rs` exercises the forward/reverse string-array
iterators and exhaustion. Run in release mode: this defect can be hidden by debug
compilation. The native Linux release workflow and local Flatpak recipe retain
the optimized regression gate. The Flatpak package also installs the GLib MIT
notice alongside the application's notices.

Code remediation and a hosting provider's alert classification are separate.
Do not suppress the advisory or assert automatic alert closure merely because
this local backport retains the affected upstream version number. Remove the
patch only after the entire GTK/WebKit dependency chain can use a verified fixed
release, then repeat native and offline package validation.
