# Mourn frontend and desktop client

Vue 3 / Quasar / Pinia frontend, SSR server, and Tauri 2 desktop wrapper for the
Mourn identity platform. The backend is a separate project. Messaging uses a
custom Double-Ratchet-style direct-message implementation and `ts-mls` for Suites;
this is not the Signal protocol and has not been independently audited here.
The service routes and can retain encrypted messages. Local history, saved
credentials, notifications, and downloaded media have separate privacy properties.
See [SECURITY.md](SECURITY.md).

## Release status

Mourn is in active development. Signed builds for Windows and Linux, the Android
app, and the Flatpak packaging are produced from tagged commits; see
[flatpak/README.md](flatpak/README.md) for the Linux packaging notes.

## Development

- Bun **1.4.2** (`bun.lock` is authoritative).
- Node **22.22.0** in CI; the supported minimum is declared in `package.json`.
- Rust **1.94.0** is the current native verification baseline.
- Windows native builds need MSVC build tools and WebView2.
- Linux native builds need GTK 3, WebKitGTK 4.1, libsoup 3, OpenSSL, and tray
  development libraries. Flatpak provides a separately verified SDK/runtime.

After cloning this repository using its actual published clone URL:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run tauri --version
node node_modules/@quasar/app-vite/bin/quasar.js prepare
cp .env.example .env
bun run dev
```

Dependency lifecycle scripts are not automatically trusted. If a package needs a
build/install script on your platform, inspect and approve it first; do not use
an unfrozen install to repair the dependency graph.

Development defaults must point to your local/test backend. The desktop build's
production CSP allows the Mourn service; alternative packaged endpoints need a
matching, reviewed CSP change. Never launch a verification build against the live
service with real saved credentials.

## Public build configuration

All renderer configuration is public. Never put database passwords, SMTP secrets,
session/pepper secrets, Vault attestation secrets, signing keys, or Cap secrets in
this project or in any `VITE_*` value. `.env.example` contains frontend values only.
Quasar's `.env` export is restricted to this documented allowlist:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE` | HTTP API origin; local proxy/test service for development |
| `VITE_WS_BASE` | WebSocket service base |
| `VITE_VAULT_WS_BASE` | Optional explicit Vault WebSocket origin |
| `VITE_CAP_API_ENDPOINT` | Public Cap endpoint including its public site key |
| `VITE_DISCORD_RPC_CLIENT_ID` | Optional public Discord application ID |
| `VITE_KLIPY_API_KEY` | Optional **client-visible** media-provider key; not a secret |
| `MOURN_ENABLE_UPDATER` | Build-time updater flag; Flatpak still rejects native updates |
| `MOURN_TARGET` | `desktop` / `mobile`; unset means web |
| `MOURN_ISOLATED_BUILD=1` | Ignore project `.env` files for CI/packaging; use explicit public values |

## Checks and builds

```sh
bun run typecheck
bun run lint
bun run test
bun run test:release
python -B flatpak/test_sources.py
python -B flatpak/prepare-sources.py --check
cargo check --offline --locked --manifest-path src-tauri/Cargo.toml
bun run build:spa
bun run build:spa:desktop
bun run build:ssr
```

Tests use synthetic fixtures and block live transports. Builds generate `.quasar`,
`dist`, and native target outputs. They do not prove that the packaged app starts
or that backend authorization is correct. See the report for actual local results.

SPA output is `dist/spa`; SSR output is `dist/ssr`. Native packaging embeds the
**desktop** SPA, with hash routing and native feature flags, not the web SPA.
Use `bun run tauri build` only in an appropriately configured packaging environment.

The signed desktop workflow is manual, protected by the `release-signing`
environment, read-only toward repository contents, and uploads review artifacts
only. It validates exact tags, target architectures, package signatures against
the source-pinned updater public key, checksums, and platform-shard identity
before preparing a combined draft. Linux AppImage tooling additionally requires
an independently reviewed `linuxdeploy_sha256` workflow input; no unverified
cached/downloaded linuxdeploy executable is accepted. It does **not**
publish GitHub releases or update the backend's live updater configuration.
Android and web SSR builds are separate manual review artifacts, also protected
by `release-signing` with read-only repository permissions. The web artifact
contains the SSR tarball, SHA-256 checksum, runtime dependency lockfile, and
`BUILD_INFO.json` stamped with the checked-out tag commit. It neither waits for
a desktop GitHub release nor publishes assets or deploys to a live channel.
Public Cap/Klipy build configuration uses Actions secrets first, with variables
as fallback; these values are embedded in the bundle, not private credentials.

## Source distribution, licensing and attribution

Mourn Team-contributed code is licensed under **AGPL-3.0-only** (GNU Affero
General Public License version 3 only), not an “or later” grant. See the exact
license text in [LICENSE](LICENSE) and the scope and copyright notice in
[NOTICE.md](NOTICE.md). Copyright (C) Mourn Team applies only to work the team
contributed and believes it owns; third-party notices and licenses remain intact.

You may use, modify and redistribute covered work, including commercially, under
the AGPL. When conveying copies or modified versions, comply with its source,
notice and license requirements. Section 13 also requires a modified version
supporting remote network interaction to prominently offer its Corresponding
Source to those users. The license text controls; this is only a summary.

The Mourn name and logos have separate [trademark rules](TRADEMARKS.md), not
additional code-license restrictions. The team states that it created the original
logos and sounds; this statement does not replace a path-level provenance review.
Third-party dependency, asset, font and media clearance remains required; see
[THIRD_PARTY.md](THIRD_PARTY.md). License adoption alone does not clear a release.
Signal inspiration is not evidence of copied implementation, licensing clearance,
or license compatibility, and does not imply Signal endorsement.

The source-archive tool refuses to distribute a dirty tree or a tree without a
project license. Scans redact matches and cannot certify that Git history is safe.

## Contributing and support

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md),
[SECURITY.md](SECURITY.md), and [SUPPORT.md](SUPPORT.md).
