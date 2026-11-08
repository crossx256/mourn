# Third-party attribution and asset clearance

This is a clearance checklist, not a declaration that all bundled assets are
licensed. Public release is blocked until a maintainer completes the ledger and
supplies the required notices/permission evidence.

| Material | Evidence to collect before distribution |
| --- | --- |
| JavaScript dependency graph (`bun.lock`) | Exact resolved versions, SPDX licenses, notices and required license texts; include transitive/bundled runtime assets |
| Rust dependencies (`src-tauri/Cargo.lock`) | Per-crate licenses/notices and any native-library obligations |
| Quasar extras fonts/icons | Notices for the exact bundled Roboto, Material Icons/Symbols, MDI and Font Awesome versions |
| `@fortawesome/fontawesome-free` | Distinguish font, icon and code licenses; preserve their relevant notices |
| `public/`, `src/assets/`, Tauri icons | Original source, author/owner, applicable license, modification record and distribution permission for every custom image, audio, font and icon |
| Remote media/fonts/GIFs | Provider terms, API-key distribution terms, privacy disclosure and whether assets are redistributed or only requested at runtime |
| AppStream screenshots/branding | Owner approval and a real accessible screenshot URL without private user content |
| Vendored helper scripts | Preserve upstream copyright/license headers and provenance; review before updating |

Do not infer permission from a filename, a downloadable URL, a package being free
of charge, or an earlier README assertion. Do not apply the chosen project license
to third-party work. Keep an inventory keyed by path/package version, owner,
source URL, license identifier, notice location and evidence of permission.

## Approved project license and team statement

The approved license for Mourn Team-contributed code is AGPL-3.0-only; see
[NOTICE.md](NOTICE.md) and [LICENSE](LICENSE). This resolves the historical
project-license choice, not third-party clearance. Copyright (C) Mourn Team
covers only work the team contributed and believes it owns, not dependencies,
external contributions or other third-party works.

The team states that it made the original Mourn logos and sounds. Those original
works are offered under AGPL-3.0-only, including redistribution of existing
unmodified works; logo trademark rights remain separate under
[TRADEMARKS.md](TRADEMARKS.md). This team statement is not independently verified
path-by-path provenance and does not establish ownership of every bundled asset.
The ledger above remains required, including mapping each claimed original asset
to its actual path and recording any third-party inputs and notices.

Signal inspiration does not prove copied implementation, licensing clearance or
compatibility. Inspect any actual borrowed implementation and its exact upstream
license and obligations; do not infer permission from a protocol description or
inspiration claim. Dependency advisory/license tools were not queried against an
external registry as part of this licensing change.

## Vendored build/reference helpers

- `scripts/bundler-tools/linuxdeploy-plugin-gtk.sh` contains modified code from
  tauri-apps/linuxdeploy-plugin-gtk. Upstream license: MIT.
  Copyright 2018-2019 TheAssassin and the linuxdeploy contributors.
  The full upstream copyright, permission and warranty text is preserved in
  `scripts/bundler-tools/linuxdeploy-plugin-gtk.LICENSE.txt`.
  The local script records modifications in its header. The historical imported
  revision has not yet been established; the reviewed upstream license is at
  https://github.com/tauri-apps/linuxdeploy-plugin-gtk/blob/dda522bce37387f1b853d9095713bfaa924c8423/LICENSE.txt .
  That reviewed revision is not evidence of the revision originally imported.

- `flatpak/flatpak-cargo-generator.py` is an unchanged copy of
  flatpak/flatpak-builder-tools `cargo/flatpak-cargo-generator.py`, verified against
  upstream Git blob `0b5744a366d0750fb6a04811db6d52f1f74df95b` at file-changing
  commit `41c20aa10819cdb2a4f3ca171758a96d1955c018`.
  Source: https://github.com/flatpak/flatpak-builder-tools/blob/41c20aa10819cdb2a4f3ca171758a96d1955c018/cargo/flatpak-cargo-generator.py .
  Upstream declares MIT in `__license__`; its Cargo-generator project metadata
  also declares MIT. The inspected upstream file and Cargo-generator directory
  do not supply a copyright-holder notice. The existing declaration is retained;
  the MIT permission and warranty text is in the adjacent
  `flatpak/flatpak-cargo-generator.LICENSE.txt`. No copyright-holder identity or
  Mourn ownership is inferred from the missing notice. Upstream copyright
  attribution remains incomplete; preserve any specific notice later supplied.
  This script is retained as reference, not used by the current Flatpak recipe;
  it is nevertheless redistributed with a source snapshot that includes it.

- `scripts/bundler-tools/mourn-gstreamer-bundle.sh` is a newly authored Mourn
  GStreamer 1.0 packaging adapter under the project's AGPL-3.0-only terms. The
  former copied implementation with unverified redistribution permission has
  been replaced; `linuxdeploy-plugin-gstreamer.sh` is now only an original
  compatibility launcher. The adapter header records public interface sources,
  not borrowed implementation. Tests exercise actual ELF relocation and installed
  audio/video pipelines, but use a synthetic dependency resolver and host shared
  libraries: they are not full AppImage or binary-license clearance.

## Vendored GLib wrapper

`src-tauri/vendor/glib` contains the MIT-licensed published GLib Rust wrapper
`0.18.5` with the upstream `VariantStrIter` safety fix backported. Its original
package metadata, authorship and license are retained; Mourn does not claim
ownership of the upstream implementation. See `src-tauri/vendor/README.md`, the
original upstream patch, and `glib.provenance.json` for exact source revisions,
archive checksum, modifications and the complete file-hash inventory. The local
Flatpak recipe installs `glib/LICENSE` with the package notices.

## Retained effects and artwork

The origin, authorship and redistribution permissions for the starfield
background and the embedded default cursor effect are **UNKNOWN**. These
retained effects are not claimed as original project artwork or covered by
Mourn's project license. Their appearance is unchanged; this entry records
unresolved rights, not permission to redistribute them.

The wallet/donation artwork at the paths listed in [NOTICE.md](NOTICE.md) is
project-original work covered by that license statement.

## Runtime emoji artwork

Messaging emoji artwork is Twemoji 15.1.0 from the jdecked/twemoji project,
requested at runtime from jsDelivr by `src/utils/messagingEmoji.ts`.
Twemoji graphics are licensed under Creative Commons Attribution 4.0
International (CC-BY-4.0), not the project's AGPL license. The application
constructs asset URLs but does not alter the upstream SVG artwork in this path.

- Project/source: https://github.com/jdecked/twemoji/tree/v15.1.0
- Graphics license: https://github.com/jdecked/twemoji/blob/v15.1.0/LICENSE-GRAPHICS
- License terms: https://creativecommons.org/licenses/by/4.0/
- Upstream attribution guidance: https://github.com/jdecked/twemoji/blob/v15.1.0/README.md#attribution-requirements

This acknowledgement does not imply endorsement. The source snapshot contains
URL-generation/display code, not a vendored copy of the remote SVG collection.
If artwork is later changed or vendored, record changes and retain applicable
supplied attribution notices. The software's MIT notice is not a substitute for
the graphics attribution.

## Source inventory versus built-distribution notices

[THIRD_PARTY_INVENTORY.md](THIRD_PARTY_INVENTORY.md) records observed packages,
font licenses, local/embedded assets and unresolved provenance. Dependency locks
are not copies of dependency source, and configured or cached packages are not
proof of a final linked/bundled payload. Conversely, retained helper scripts and
unused tracked artwork remain relevant to source redistribution.

The notices added here do not complete a binary notice bundle. Before a binary
release, preserve full applicable dependency/font/native license texts and
notices in the actual distribution, provide accessible local acknowledgements
(including Twemoji), and verify any source-availability obligations against that
exact payload. Repository-root documents and licenses in an installed dependency
cache do not establish that `dist/spa` or an installer carries those notices.
The copied GStreamer implementation was replaced, not relabeled as licensed
third-party work. The original visual effects remain unchanged and are not
cleared by that packaging fix. Other UNKNOWN inventory entries retain their
stated limits; no complete source or binary legal clearance is asserted here.
