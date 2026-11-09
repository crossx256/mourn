# Experimental Flatpak packaging (work in progress)

This directory contains Mourn's local Flatpak recipe. It is not a ready-to-submit
Flathub package. Keep packaging validation separate from account, media, portal,
keyring, architecture and redistribution-rights checks.

The GNOME 51 recipe has not been built or runtime-validated. Secret portal
integration is unfinished, so direct Secret Service access remains necessary.
Credential namespace isolation is also incomplete: the Vault commands still use
the native keyring service. Test only with synthetic credentials in an isolated
environment; do not install this branch as a release or use native saved secrets.

## Dependencies

Use Python 3.11+, Flatpak and flatpak-builder on Linux. The manifest selects
GNOME 51 and the Node 22 / Rust stable SDK extensions. Install compatible runtime,
SDK and extension branches, and record their exact OSTree commits before building.

```sh
flatpak --user info org.gnome.Platform//51
flatpak --user info org.gnome.Sdk//51
flatpak run --command=pkg-config --devel org.gnome.Sdk//51 --modversion gtk+-3.0 webkit2gtk-4.1 libsoup-3.0 openssl
```

The GNOME runtime does not supply the AppIndicator library loaded by Tauri's tray.
The recipe builds pinned Ayatana dependencies from `shared-modules/`, including
libdbusmenu and the build-only intltool dependency. See
[shared-modules/README.md](shared-modules/README.md) for provenance and local changes.
Runtime notices are installed under `/app/share/licenses/bio.mourn.newlife/`.

## Generate dependency sources

From the frontend root:

```sh
python3 -B flatpak/prepare-sources.py
python3 -B flatpak/prepare-sources.py --check
python3 -B flatpak/test_sources.py
node --test tests/packaging.test.mjs
```

Commit `cargo-sources.json`, `node-sources.json`, `node-layout.json` and
`source-locks.json` with lockfile changes. JavaScript sources come from Bun's
locked graph; the legacy npm lockfile is not an input. Integrity-pinned tarballs
are extracted into their locked paths. `setup-node.mjs` validates package
identities and creates executable links without running dependency lifecycle code.
Quasar's Capacitor-mode alias points to this same root tree, including in desktop
SPA builds. Do not copy host dependencies or run an online package install.

Cargo sources use lockfile checksums and `cargo/vendor`; compilation uses
`cargo build --frozen`. Canonical lock commitments use UTF-8/LF text, not arbitrary
Windows CRLF worktree bytes. Both x86_64 and aarch64 source layouts are generated;
this does not prove either architecture has compiled or run.

## Reviewed GLib backport

GTK3 pins the Rust GLib wrapper to `0.18`. The local compatibility backport in
`src-tauri/vendor/glib` retains upstream `0.18.5` with the `VariantStrIter`
safety fix; see `src-tauri/vendor/README.md` for the exact source and patch.
Its version is not relabeled as an upstream fixed release. Optimized iterator
regressions run after frontend compilation in the offline recipe.

`source-locks.json` schema 3 commits the reviewed local source alongside the
canonical lockfiles. The generator checks a pinned provenance manifest and every
vendored file, rejecting source drift, symlinks, extra/missing files, unexpected
local packages and reintroduced registry GLib. Source code is part of the audited
application archive; no local dependency is fetched or patched during compilation.
The upstream MIT notice remains separate from the project's license and is
installed in the package.

## Isolated build

The checked-in manifest uses a development `type: dir`, `path: ..` source. A
network-isolated `--sandbox` builder rejects a directory outside the manifest's
folder. Export a reviewed, committed source ref with `make-source-archive.sh` into
a separate workspace, beside a disposable manifest. Replace only its application
source block with `type: archive`, the local archive path, its measured SHA-256,
and `strip-components: 0`. Retain the dependency JSON files and `shared-modules/`
next to that manifest. Never copy a working tree's `.env`, credentials, dependency
trees or generated outputs into the archive.

Set `VITE_CAP_API_ENDPOINT` explicitly in the disposable manifest's application
build environment, using the reviewed public Cap endpoint and public site key.
Do not read private environment files to populate a public recipe. Production
builds use the production API/WebSocket URLs; staging/offline tests must override
them explicitly. Native self-updates remain disabled; Flatpak owns updates.

From the disposable workspace:

```sh
flatpak-builder --user --jobs=1 --state-dir=state --download-only --force-clean build-dir flatpak/bio.mourn.newlife.yml
flatpak-builder --user --jobs=1 --state-dir=state --sandbox --disable-download --force-clean --keep-build-dirs --repo=repo build-dir flatpak/bio.mourn.newlife.yml
flatpak build-bundle repo mourn-test.flatpak bio.mourn.newlife
```

Download sources first, then compile with downloads and build-time network access
disabled. Preserve `state/` across retries. Limit Cargo workers and Node's heap
when the builder has limited memory. Pinning inputs does not establish
byte-for-byte reproducibility; that requires independent rebuild comparison.

## Runtime validation

Install into an isolated test environment. Flatpak uses `bio.mourn.newlife`, while
the native client keeps `bio.mourn.desktop`. This does not yet establish complete
credential isolation; the Vault keyring service is still shared.
Use temporary app data, synthetic accounts, and staging or explicitly reviewed
production read-only checks. Never reuse saved production credentials for a test.

Verify the finished app, not only SDK pkg-config or `ldd`: dynamically loaded
libraries can still be missing. Required checks include:

- Rendered UI, X11 and Wayland, icons, reload and same-user relaunch behavior.
- Offline startup and reconnection without a request storm.
- Account sign-in/out/switching and encrypted storage with synthetic accounts.
- Available, locked and absent Secret Service; no plaintext fallback or key loss.
- Audio/video, notifications, tray behavior and graphics-driver compatibility.
- File-dialog portal save/cancel, with no host/home filesystem permission grant.
- No native updater download/install attempt inside Flatpak.
- Separate x86_64 and aarch64 builds and runtime checks.

A private session bus without service activation can isolate startup tests from
host keyring and portal services. This intentionally cannot validate real host
portal/keyring integration. Test those separately. Remove temporary installations
when finished; do not leave a loopback-only test package installed as a release.

```sh
desktop-file-validate flatpak/bio.mourn.newlife.desktop
appstreamcli validate --pedantic flatpak/bio.mourn.newlife.metainfo.xml
```

Validate hosted screenshots and metadata with network access as well. Metadata
syntax validation does not prove a screenshot URL exists, ownership, licensing
clearance, or that the declared release has been published.

## Public distribution

Audit the exact intended source ref with `scripts/source_audit.py`; a pattern
scan is not a complete secret, history, privacy or licensing audit. The archive
helper creates a local audited source archive and never uploads it. Publishing,
tagging, pushing and deployment remain separate actions.

The existing `submission-manifest.mjs` utility can replace a local source with an
explicit HTTPS archive URL and measured checksum for external distribution. It
requires independently verified public retrieval and explicit runtime/SDK/extension
configuration. Its acknowledgement flag is not remote verification. It does not
make a package eligible for Flathub and must not be used to misrepresent one.

Flathub's [current requirements](https://docs.flathub.org/docs/for-app-authors/requirements)
prohibit generated or assisted manifests and automated submission interactions.
They also prohibit application IDs ending in generic terms such as `.desktop`.
This local package uses `bio.mourn.newlife`. Its build-only Tauri configuration
override and `MOURN_FLATPAK_APP_ID` must agree. Native Windows/AppImage installs
retain `bio.mourn.desktop`; Android retains its existing package identity.
Flatpak account secrets, internal keys, graphics preferences and instance locks
use its separate namespace rather than importing or overwriting native storage.
A Flathub submission needs independently authored compliant packaging,
appropriate provenance disclosures and review of all current requirements.

Do not distribute until custom asset/font rights and attribution are established.
Keep real, publicly accessible screenshots and accurate release/OARS metadata;
never invent an archive URL, screenshot, checksum or release date to pass a gate.
