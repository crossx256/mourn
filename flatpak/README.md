# Flatpak preparation and release gates

This is a **candidate build recipe**, not a verified Flathub submission. No
Flatpak was built, installed, or launched during Windows remediation. A Linux
maintainer must complete every unchecked step below before claiming readiness.

## What changed

- One application module installs the actual `mourn-desktop` binary and the
  desktop/AppStream/icon files from that same source tree.
- `MOURN_TARGET=desktop`, `custom-protocol`, and `dist/spa` select the native
  renderer and embed assets; no dev server, sidecar, or prebuilt frontend is used.
- Node dependencies come from **Bun's locked graph**, not the stale npm lock/cache.
  Flatpak extracts integrity-pinned npm tarballs directly to their locked
  `node_modules` paths. `setup-node.mjs` checks identities and creates executable
  links; it does not run package lifecycle scripts. This is a project-specific
  preparation path and must be exercised with an offline Linux build.
- Cargo crates use Cargo.lock checksums and a generated `.cargo/config.toml`
  pointing to `cargo/vendor`; `cargo build --frozen` cannot access the network.
- Native self-updates are disabled/rejected in Flatpak. Updates belong to Flatpak.
- No home/host filesystem grant, privileged installer, or default Discord-socket
  grant. File saving uses an explicitly selected dialog path; desktop portals
  and keyring integration require runtime testing.

## Generate dependency sources (offline; no installs)

From the frontend root, with Python 3.11+:

```sh
python -B flatpak/prepare-sources.py
python -B flatpak/prepare-sources.py --check
python -B flatpak/test_sources.py
```

Commit `cargo-sources.json`, `node-sources.json`, `node-layout.json`, and
`source-locks.json` together with lockfile changes. The generator rejects
non-registry/unhashed inputs and dependency/override drift. It supports the current
Bun lock format and Linux x86_64/aarch64; new formats/platforms require review.
Lock commitments explicitly use canonical UTF-8/LF text (`source-locks.json`
schema 2); `.gitattributes` enforces LF in distributed checkouts. They are not
hashes of arbitrary Windows CRLF worktree bytes. The only current bin collision,
`sass`, has a reviewed `sass-embedded` owner; new contenders fail closed.
`package-lock.json` is legacy and is not a Flatpak input. Do not run `npm ci`.
The old upstream generator is retained as reference, not executed by this recipe.

## Linux environment validation (not performed here)

GNOME 50 and its Node/Rust SDK extensions are **candidate requirements**, not a
claim that all required libraries are available. Resolve/install the matching
runtime, SDK and extension refs on a Linux builder under your normal policy;
record their exact OSTree commits. Before building, verify:

```sh
flatpak --user info org.gnome.Platform//50
flatpak --user info org.gnome.Sdk//50
flatpak run --command=pkg-config --devel org.gnome.Sdk//50 --modversion gtk+-3.0 webkit2gtk-4.1 libsoup-3.0 openssl
```

Also check `cargo --version`, `rustc --version`, and `node --version` inside a
builder configured with the manifest's SDK extensions. Verify runtime shared
libraries (including tray/notification dependencies), not just SDK pkg-config
metadata. If WebKitGTK 4.1 or GTK3 is absent, choose a supported compatible runtime
or add a reviewed checksum-pinned module. Do not guess archive hashes.

## Local build, then offline rebuild

The checked-in manifest deliberately uses a local `type: dir` development source
and excludes `.git`, `.env*`, node_modules, and generated outputs. It is **not**
a public-source manifest. In a disposable Linux workspace:

```sh
flatpak-builder --user --download-only build-dir flatpak/bio.mourn.desktop.yml
flatpak-builder --user --disable-download --force-clean build-dir flatpak/bio.mourn.desktop.yml
```

Downloads occur only in the first step and require separate network approval.
Run the second step with network access disabled at the builder/container boundary
to establish a real offline build. Preserve logs, SDK commits, architecture,
source commitments and artifact hashes. Repeat with a fresh build directory;
compare outputs and explain nondeterministic metadata before claiming byte-for-byte
reproducibility. Hash-pinned inputs alone are not that proof.

After reviewing finish-args, install only into a test user/profile, then launch
with a **mock/staging backend and synthetic accounts**, never production saved
credentials. The checked-in production URLs/CSP need an explicitly reviewed test
override for a runtime test. Validate:

- Wayland and X11 startup, embedded assets, reload, icon/window association.
- GTK/WebKit/GStreamer audio/video, Mesa/NVIDIA paths and accessibility zoom.
- Dialog portal save/cancel; no unrestricted home or host access.
- Locked, absent, and available Secret Service; restart/stay-logged-in without
  replacing keys or falling back to plaintext on failure.
- Notifications, permission denial, tray presence/absence and minimize/restore.
- Same-user relaunch raises the original process; different OS users are isolated.
- Offline boot and reconnection; no request storm; updater never requests or installs.
- Account switch during sends/history/uploads; retention, account wipes, and
  migration failure recovery using fixtures. Do not infer backend controls from UI.
- x86_64 and aarch64 separately. Windows Cargo checks do not compile Linux-only code.

Discord presence is optional: a user may grant the specific `xdg-run/discord-ipc-0`
socket if desired. It is not a reason to grant all of `xdg-run` or the home folder.
There is currently no registered deep-link handler; the desktop launcher therefore
passes no `%U`/`%F` arguments. Add a handler only with scheme-validation tests.

## Public-source / Flathub gate

1. The project declares AGPL-3.0-only. Resolve remaining custom asset/font
   provenance and review the attribution ledger; the SPDX declaration alone
   does not establish third-party redistribution rights.
2. Verify repository/bugtracker ownership and publish real screenshots. Record the
   release's actual date/version and OARS rating after product-owner review.
3. Review and commit all fixes. Audit the **exact** intended source ref:
   `python -B scripts/source_audit.py COMMIT`. Before committing, scan the exact
   index with `python -B scripts/source_audit.py --staged`; this intentionally
   excludes unstaged/untracked bytes. Investigate findings privately.
   This does not audit all historical Git objects or certify legal clearance.
4. Create a local audited archive using
   `flatpak/make-source-archive.sh COMMIT EXISTING_DIR/source.tar.gz`.
   Review its contents and SHA-256. Publishing requires a separate manual action.
5. Replace the local `type: dir` source in a submission copy with that publicly
   accessible archive URL plus its actual SHA-256 (and `strip-components: 0`
   for the archive tool's root-level layout). Include generated dependency sources.
   Never substitute an invented URL/hash or a private clone URL.
6. Run `desktop-file-validate` and `appstreamcli validate --pedantic` against the
   installed files, then Flathub's manifest/AppStream permission linting on both
   architectures. Review any portal or filesystem permission request explicitly.

No submission, package install, release publication, tagging, or deployment is
automated by these preparation scripts.

## Offline public manifest preparation (no build or download)

`node flatpak/submission-manifest.mjs CONFIG.json VERIFIED_ARCHIVE OUTPUT.yml`
creates a new file only (refuses overwrite). Keep it alongside the dependency
JSON files, since their relative references are preserved. The archive must contain
all reviewed source and packaging files at the expected archive root layout.

Supply JSON keys `archiveUrl`, `archiveSha256`, `publicArchiveVerified: true`,
`runtimeVersion`, `runtimeCommit`, `sdkCommit`, `nodeVersion`, `rustVersion`, and
`capEndpoint`. There are deliberately no guessed defaults. `runtimeCommit` and
`sdkCommit` are exact 64-character OSTree commits; extension versions are explicit
branches, **not immutable extension commits**. Record and independently verify
extension OSTree commits on the builder too. The generator checks the local archive
SHA-256 and requires HTTPS URLs without embedded credentials or query strings.
It performs no network access: the acknowledgement is operator-supplied evidence,
not proof that the remote URL exists or serves the same bytes. Verify anonymous
public retrieval, checksum, archive layout and source audit separately. Domain
validation is syntactic, not a DNS/public reachability or ownership attestation.

No concrete public Cap endpoint was found in tracked documentation. Do not read a
private `.env` to populate a public recipe: obtain a reviewed documented public
endpoint including its public site key. The local manifest fails before dependency
setup when it is absent; generated manifests supply it explicitly. Client themes
remain enabled, matching the current desktop release configuration.

Publication gates for Flathub: the screenshot URL
`https://mourn.bio/assets/screenshot-main.png` was previously reported 404 and has
not been replaced with a placeholder; supply a real screenshot. Repository and
bugtracker details, custom asset/font provenance and OARS review are also
outstanding (the project SPDX declaration is already AGPL-3.0-only).
AppStream release date 2026-10-21 matches the `v1.5.3` Git tag. Runtime/SDK library compatibility,
extension commits, both architecture builds, offline rebuild and all runtime smoke
tests above remain unverified. Do not infer readiness from offline metadata checks.
