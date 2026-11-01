# Local third-party dependency and asset inventory

Snapshot: 2026-10-27. Direct JavaScript rows were refreshed from installed packages after the Quasar/Vite upgrade. Asset and Rust analysis reflects the versions pinned in the lockfiles and Cargo manifests. This is an inventory for reference, **not a legal audit, license-compatibility opinion, or complete SBOM**.

## Critical findings and limitations

- **Unused GSAP dependency removed.** GSAP 3.15.0 used custom no-charge terms whose AGPL compatibility was not established, and nothing in the source referenced it outside the dependency declaration and locks. It has been removed from `package.json`, `bun.lock` and the generated Flatpak sources.
- The earlier `ts-mls@1.6.2` inventory was **MIT, not BSD**, in both installed metadata and `node_modules/ts-mls/LICENSE` (Copyright 2025 Luka Jacobowitz). This finding is about the installed version, not all upstream history.
- No other definite incompatible dependency was established by this bounded inspection. Missing cached sources, custom terms, embedded notices and unknown asset provenance prevent an “all cleared” conclusion.
- Installed package versions below are resolved local observations, not the manifest ranges. `bun.lock` is authoritative. The obsolete root `package-lock.json` was removed during migration because Bun otherwise re-imported its stale resolutions when regenerating a missing lock. The isolated SSR folder has its own manifest and Bun lock. Frozen installs passed with the locally available Bun 1.3.3; the declared Bun 1.4.2 still needs verification. Installed package license claims are not independent provenance proof.
- Cargo metadata was read with `cargo metadata --offline --no-deps --format-version 1 --manifest-path src-tauri/Cargo.toml` (successful; resolve is null). Lock entries are not proof that every package ships on every target. No full dependency resolution, native binary inventory, mobile SDK inventory, or packaged-artifact examination was performed.

## Direct JavaScript packages

Each row’s metadata evidence is `<installed directory>/package.json`. “Notices” lists observed root-level license/notice/copying/copyright paths, not a guarantee that all embedded third-party notices were identified. No notice file means metadata-only evidence and an outstanding notice gap. Sources/owners must be traced through the installed metadata and notices; no remote authenticity check was made.

### dependencies

| Package | Requested | Installed | Observed license declaration | Notices |
| --- | --- | --- | --- | --- |
| @aparajita/capacitor-secure-storage | ^8.0.0 | 8.0.1 | MIT | `node_modules/@aparajita/capacitor-secure-storage/LICENSE` |
| @capacitor/android | ^8.5.0 | 8.5.3 | MIT | `node_modules/@capacitor/android/LICENSE` |
| @capacitor/app | ^8.1.1 | 8.1.2 | MIT | `node_modules/@capacitor/app/LICENSE` |
| @capacitor/camera | ^8 | 8.2.6 | MIT | `node_modules/@capacitor/camera/LICENSE` |
| @capacitor/core | ^8.5.0 | 8.5.3 | MIT | `node_modules/@capacitor/core/LICENSE` |
| @capacitor/filesystem | ^8 | 8.1.5 | MIT | `node_modules/@capacitor/filesystem/LICENSE` |
| @capacitor/haptics | ^8 | 8.0.2 | MIT | `node_modules/@capacitor/haptics/LICENSE` |
| @capacitor/ios | ^8.5.0 | 8.5.3 | MIT | `node_modules/@capacitor/ios/LICENSE` |
| @capacitor/local-notifications | ^8.0.0 | 8.3.1 | MIT | `node_modules/@capacitor/local-notifications/LICENSE` |
| @capacitor/push-notifications | ^8.0.0 | 8.1.3 | MIT | `node_modules/@capacitor/push-notifications/LICENSE` |
| @capacitor/share | ^8 | 8.0.3 | MIT | `node_modules/@capacitor/share/LICENSE` |
| @capacitor/status-bar | ^8 | 8.0.4 | MIT | `node_modules/@capacitor/status-bar/LICENSE` |
| @capawesome/capacitor-badge | ^8.0.3 | 8.0.4 | MIT | `node_modules/@capawesome/capacitor-badge/LICENSE` |
| @fingerprintjs/fingerprintjs | ^5.0.1 | 5.3.0 | MIT | `node_modules/@fingerprintjs/fingerprintjs/LICENSE` |
| @fortawesome/fontawesome-free | ^7.2.0 | 7.3.1 | (CC-BY-4.0 AND OFL-1.1 AND MIT) | `node_modules/@fortawesome/fontawesome-free/LICENSE.txt` |
| @hpke/chacha20poly1305 | 1.7.1 | 1.7.1 | MIT | `node_modules/@hpke/chacha20poly1305/LICENSE` |
| @hpke/ml-kem | 0.2.1 | 0.2.1 | MIT | `node_modules/@hpke/ml-kem/LICENSE` |
| @noble/ciphers | 2.1.1 | 2.1.1 | MIT | `node_modules/@noble/ciphers/LICENSE` |
| @noble/curves | 2.0.1 | 2.0.1 | MIT | `node_modules/@noble/curves/LICENSE` |
| @noble/hashes | 2.0.1 | 2.0.1 | MIT | `node_modules/@noble/hashes/LICENSE` |
| @noble/post-quantum | 0.5.2 | 0.5.2 | MIT | `node_modules/@noble/post-quantum/LICENSE` |
| @quasar/extras | ^1.16.4 | 1.18.0 | MIT | `node_modules/@quasar/extras/LICENSE` |
| @tauri-apps/api | 2.11.1 | 2.11.1 | Apache-2.0 OR MIT | `node_modules/@tauri-apps/api/LICENSE-APACHE-2.0`; `node_modules/@tauri-apps/api/LICENSE-MIT`; `node_modules/@tauri-apps/api/LICENSE.spdx` |
| @tauri-apps/plugin-dialog | 2.7.2 | 2.7.2 | MIT OR Apache-2.0 | `node_modules/@tauri-apps/plugin-dialog/LICENSE.spdx` |
| @tauri-apps/plugin-fs | 2.5.1 | 2.5.1 | MIT OR Apache-2.0 | `node_modules/@tauri-apps/plugin-fs/LICENSE.spdx` |
| @tauri-apps/plugin-opener | 2.5.4 | 2.5.4 | MIT OR Apache-2.0 | `node_modules/@tauri-apps/plugin-opener/LICENSE.spdx` |
| @tauri-apps/plugin-process | 2.3.1 | 2.3.1 | MIT OR Apache-2.0 | `node_modules/@tauri-apps/plugin-process/LICENSE.spdx` |
| @tauri-apps/plugin-updater | 2.10.1 | 2.10.1 | MIT OR Apache-2.0 | `node_modules/@tauri-apps/plugin-updater/LICENSE.spdx` |
| @tresjs/cientos | ^5.3.1 | 5.10.0 | MIT | `node_modules/@tresjs/cientos/LICENSE` |
| @tresjs/core | ^5.4.1 | 5.10.0 | MIT | `node_modules/@tresjs/core/LICENSE` |
| @tresjs/post-processing | ^3.3.1 | 3.11.0 | MIT | `node_modules/@tresjs/post-processing/LICENSE` |
| axios | ^1.20.0 | 1.21.0 | MIT | `node_modules/axios/LICENSE` |
| cap-widget | 0.1.57 | 0.1.57 | Apache-2.0 | `node_modules/cap-widget/LICENSE` |
| dompurify | ^3.4.17 | 3.4.17 | (MPL-2.0 OR Apache-2.0) | `node_modules/dompurify/LICENSE`; `node_modules/dompurify/LICENSE-MPL` |
| follow-redirects | ^1.16.1 | 1.16.2 | MIT | `node_modules/follow-redirects/LICENSE` |

| idb-keyval | ^6.2.2 | 6.3.0 | Apache-2.0 | `node_modules/idb-keyval/LICENCE` |
| isomorphic-ws | ^5.0.0 | 5.0.0 | MIT | `node_modules/isomorphic-ws/LICENSE` |
| libsodium-wrappers | ^0.8.2 | 0.8.4 | ISC | `node_modules/libsodium-wrappers/LICENSE` |
| marked | ^18.0.9 | 18.1.2 | MIT | `node_modules/marked/LICENSE` |
| pinia | ^3.0.1 | 3.0.4 | MIT | `node_modules/pinia/LICENSE` |
| quasar | ^2.35.2 | 2.35.2 | MIT | `node_modules/quasar/LICENSE` |
| three | ^0.182.0 | 0.182.0 | MIT | `node_modules/three/LICENSE` |
| ts-mls | ^1.6.2 | 1.6.4 | MIT | `node_modules/ts-mls/LICENSE` |
| vanilla-tilt | ^1.8.1 | 1.8.1 | MIT | `node_modules/vanilla-tilt/LICENSE` |
| vue | ^3.5.43 | 3.5.44 | MIT | `node_modules/vue/LICENSE` |
| vue-advanced-cropper | ^2.8.9 | 2.8.9 | MIT | `node_modules/vue-advanced-cropper/LICENSE` |
| vue-router | ^5.4.0 | 5.4.0 | MIT | `node_modules/vue-router/LICENSE` |
| ws | ^8.21.3 | 8.22.0 | MIT | `node_modules/ws/LICENSE` |

### devDependencies

| Package | Requested | Installed | Observed license declaration | Notices |
| --- | --- | --- | --- | --- |
| @eslint/js | ^9.14.0 | 9.39.5 | MIT | `node_modules/@eslint/js/LICENSE` |
| @quasar/app-vite | ^3.10.3 | 3.10.3 | MIT | `node_modules/@quasar/app-vite/LICENSE` |
| @tauri-apps/cli | ^2.10.1 | 2.12.4 | Apache-2.0 OR MIT | `node_modules/@tauri-apps/cli/LICENSE-APACHE-2.0`; `node_modules/@tauri-apps/cli/LICENSE-MIT` |
| @types/libsodium-wrappers | ^0.8.2 | 0.8.2 | MIT | `node_modules/@types/libsodium-wrappers/LICENSE` |
| @types/node | ^22.20.5 | 22.20.5 | MIT | `node_modules/@types/node/LICENSE` |
| @types/three | ^0.182.0 | 0.182.0 | MIT | `node_modules/@types/three/LICENSE` |
| @types/vanilla-tilt | ^1.6.2 | 1.6.2 | MIT | `node_modules/@types/vanilla-tilt/LICENSE` |
| @unocss/preset-uno | ^66.12.0 | 66.12.0 | MIT |  |
| @vitejs/plugin-vue | ^6.0.10 | 6.0.10 | MIT | `node_modules/@vitejs/plugin-vue/LICENSE` |
| @vue/eslint-config-prettier | ^10.1.0 | 10.2.0 | MIT | `node_modules/@vue/eslint-config-prettier/LICENSE` |
| @vue/eslint-config-typescript | ^14.4.0 | 14.9.0 | MIT | `node_modules/@vue/eslint-config-typescript/LICENSE` |
| autoprefixer | ^10.4.2 | 10.6.2 | MIT | `node_modules/autoprefixer/LICENSE` |
| eslint | ^9.14.0 | 9.39.5 | MIT | `node_modules/eslint/LICENSE` |
| eslint-plugin-vue | ^10.12.0 | 10.12.0 | MIT | `node_modules/eslint-plugin-vue/LICENSE` |
| globals | ^16.4.0 | 16.5.0 | MIT | `node_modules/globals/license` |
| prettier | ^3.3.3 | 3.9.10 | MIT | `node_modules/prettier/LICENSE` |
| typescript | ^5.9.2 | 5.9.3 | Apache-2.0 | `node_modules/typescript/LICENSE.txt` |
| unocss | ^66.12.0 | 66.12.0 | MIT |  |
| vite | ^8.3.5 | 8.3.5 | MIT | `node_modules/vite/LICENSE.md` |
| vite-plugin-checker | ^0.11.0 | 0.11.0 | MIT | `node_modules/vite-plugin-checker/LICENSE` |
| vitest | ^4.1.12 | 4.1.12 | MIT | `node_modules/vitest/LICENSE.md` |
| vue-eslint-parser | ^10.2.0 | 10.4.1 | MIT | `node_modules/vue-eslint-parser/LICENSE` |
| vue-tsc | 3.3.10 | 3.3.10 | MIT | `node_modules/vue-tsc/LICENSE` |
| @types/compression | ^1.8.1 | 1.8.1 | MIT | `node_modules/@types/compression/LICENSE` |
| @types/express | ^5.0.6 | 5.0.6 | MIT | `node_modules/@types/express/LICENSE` |

### Isolated SSR runtime dependencies (migration follow-up)

| Package | Installed | Observed license | Notices |
| --- | --- | --- | --- |
| compression | 1.8.2 | MIT | `src-ssr/node_modules/compression/LICENSE` |
| express | 5.3.0 | MIT | `src-ssr/node_modules/express/LICENSE` |

The SSR manifest also declares its own Express/compression typings. These entries are installed metadata/notice-path evidence, not a completed bundled-subcomponent license review.

## Notable transitives from the earlier inventory (not refreshed)

| Package | Installed | Observed license | Notices |
| --- | --- | --- | --- |
| @hpke/core | 1.8.0 | MIT | `node_modules/@hpke/core/LICENSE` |
| @hpke/common | 1.10.1 | MIT | `node_modules/@hpke/common/LICENSE` |
| libsodium | 0.8.4 | ISC | `node_modules/libsodium/LICENSE` |
| postprocessing | 6.39.4 | Zlib | `node_modules/postprocessing/LICENSE.md` |
| @vue/server-renderer | 3.5.43 | MIT | `node_modules/@vue/server-renderer/LICENSE` |
| @vue/compiler-sfc | 3.5.43 | MIT | `node_modules/@vue/compiler-sfc/LICENSE` |
| @vue/runtime-core | 3.5.43 | MIT | `node_modules/@vue/runtime-core/LICENSE` |
| @tresjs/post-processing | 3.7.4 | MIT | `node_modules/@tresjs/post-processing/LICENSE` |
| three-stdlib | 2.36.1 | MIT | `node_modules/three-stdlib/LICENSE` |
| meshoptimizer | 0.22.0 | MIT | `node_modules/meshoptimizer/LICENSE.md` |
| fflate | 0.8.3 | MIT | `node_modules/fflate/LICENSE` |

`ts-mls/package.json` pins `@hpke/core` 1.8.0; that installed package declares `@hpke/common` ^1.9.0, locally 1.10.1. HPKE notices credit Ajitomi Daisuke. The direct `@noble/*` packages and HPKE extensions have individual MIT notice files listed above; preserve each notice, not just the ts-mls notice. libsodium-wrappers and its libsodium payload are separately observed ISC packages. DOMPurify offers MPL-2.0 OR Apache-2.0; record a chosen permitted branch rather than treating OR as AND. Development dependencies can carry bundled subcomponent notices (e.g. TypeScript and Prettier). This is a notable-transitive selection, not a complete JavaScript transitive license audit.

## Fonts and icons: separate licenses, not team-owned fonts

| Material / observed version | License evidence | Local asset evidence / notes |
| --- | --- | --- |
| Quasar 2.35.2 / extras 1.18.0 | `node_modules/quasar/LICENSE`; `node_modules/@quasar/extras/LICENSE` (MIT) | Extras MIT wrapper does not supersede asset licenses; its README explicitly reserves ownership to respective owners. |
| Roboto, extras README CDN v51 | `node_modules/@quasar/extras/roboto-font/LICENSE` (Apache-2.0) | `roboto-font/roboto-font.css`, `roboto-font/web-font/`, under extras; enabled in `quasar.config.ts`. |
| Material Icons, extras README CDN v145 | `node_modules/@quasar/extras/material-icons/LICENSE` (Apache-2.0) | `material-icons/material-icons.css`, `material-icons/web-font/`; enabled. |
| Material Symbols Outlined, extras README CDN v322 | `node_modules/@quasar/extras/material-symbols-outlined/LICENSE` (Apache-2.0) | Enabled in `quasar.config.ts`; font files in `material-symbols-outlined/web-font/`. The version label is the installed extras README declaration, not independently reconstructed font-build provenance. Include applicable full license/notices in built distributions. |
| MDI v7, extras README 7.4.47 | `node_modules/@quasar/extras/mdi-v7/LICENSE` (Pictogrammers Free License summary: icons/fonts Apache-2.0 or respective icon licenses; code MIT) | Enabled; mixed-origin caveat in that notice means individual icon origins may need additional review. |
| Font Awesome v6, extras README 6.7.2 | `node_modules/@quasar/extras/fontawesome-v6/LICENSE.txt` | Enabled; fonts OFL-1.1, icon artwork CC-BY-4.0, other code MIT. Distinct from standalone v7 below. |
| Font Awesome Free standalone 7.3.1 | `node_modules/@fortawesome/fontawesome-free/LICENSE.txt` | Fonts OFL-1.1, icons CC-BY-4.0, other code MIT; preserve attribution and brand-trademark notices. Installed does not prove all its assets ship. |
| OpenDyslexic, pinned upstream commit in provenance | `public/fonts/opendyslexic/OFL.txt`; `public/fonts/opendyslexic/PROVENANCE.md` | Four local WOFF2 files; Abbie Gonzalez; OFL-1.1, Reserved Font Name OpenDyslexic. Not Mourn Team fonts. |

OFL fonts remain under OFL; do not relicense them AGPL. Retain font copyright/license text and observe reserved-name restrictions on modifications. Apache assets require their applicable license/notices and modification records; Font Awesome icon attribution and trademark restrictions remain separate. Versions above are the installed extras README’s claims, not independent reconstruction of each font build.

### OpenDyslexic local hashes

The provenance file states unmodified downloads from `antijingoist/opendyslexic` commit `1824da5c0e41dc3e13ffc7f3a636dcaf695d61b7`, compiled fonts and root OFL, with earlier Git-blob verification. That earlier retrieval claim was not independently repeated online. SHA-256 below was recomputed locally:

- `public/fonts/opendyslexic/OFL.txt`: `caafcccfb70fc72458fcbda812ec8f0a06cb300cbabb87eabbb30b946124394b`
- `public/fonts/opendyslexic/OpenDyslexic-Bold-Italic.woff2`: `1aadc8fa9656c92c09c8194790d0671bcd2b4bd961ba41fb8f7e605e5c493be0`
- `public/fonts/opendyslexic/OpenDyslexic-Bold.woff2`: `b534a0b84ef3cca941ebdb506ce3f4e0010aa4ef881271bac8b6959dbf694fbf`
- `public/fonts/opendyslexic/OpenDyslexic-Italic.woff2`: `b18685dcb99b4ba903549d215c0ae2ab39a5087097614fd4100ae6d387332b47`
- `public/fonts/opendyslexic/OpenDyslexic-Regular.woff2`: `0441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695`

## Bundled local public / source / application-icon assets

The team’s approval/ownership statement for original Mourn logos and sounds is recorded in `NOTICE.md`, `THIRD_PARTY.md` and `TRADEMARKS.md`: original team works offered under AGPL-3.0-only, with trademark rights separate. This is a team statement, not independently verified path-by-path authorship. It does NOT cover third-party fonts or establish ownership of every image, recording, generated icon or source contribution.

| Path | Observed classification / outstanding provenance |
| --- | --- |
| `public/audio/graveyard-finish.mp3` | Sound; possible team-original statement coverage, but author/source and third-party samples need path-specific confirmation. |
| `public/audio/mourn-hover-2.mp3` | Sound; possible team-original statement coverage, but author/source and third-party samples need path-specific confirmation. |
| `public/audio/mourn-hover.mp3` | Sound; possible team-original statement coverage, but author/source and third-party samples need path-specific confirmation. |
| `public/audio/post.opus` | Sound; possible team-original statement coverage, but author/source and third-party samples need path-specific confirmation. |
| `public/favicon.ico` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `public/icons/favicon-32x32.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `public/icons/mournLogonoWords32x32.ico` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `public/images/xmr-donation-qr.svg` | Maintainer explicitly confirms team ownership of this wallet/donation artwork; see `NOTICE.md`. Covered by the team-original-work AGPL-3.0-only statement, not an independent clearance of third-party marks/inputs. |
| `public/mournLogoprot1.svg` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `public/mourn_notification.mp3` | Sound; possible team-original statement coverage, but author/source and third-party samples need path-specific confirmation. |
| `src/utils/notificationSoundData.ts:13` | Embedded base64 representation of `public/mourn_notification.mp3`; decoded bytes are identical, SHA-256 `81511fa51b7d9576f60d393943ad62e85406f762776a9a5cc37c068cc322fd23`. Same outstanding team-original/source/samples confirmation as the MP3, not a separate ownership finding. |
| `src/composables/useCursorEffect.ts` embedded default PNG | Original project artwork, covered by the repository license. |
| `public/plain_starfield_less_blue_2.png` | Original project artwork, covered by the repository license. |
| `public/theme-prepaint.js` | Public code/template asset; team license only to extent team-authored. Copied snippets/upstream provenance not established here. |
| `public/tray-menu.css` | Public code/template asset; team license only to extent team-authored. Copied snippets/upstream provenance not established here. |
| `public/tray-menu.html` | Public code/template asset; team license only to extent team-authored. Copied snippets/upstream provenance not established here. |
| `public/tray-menu.js` | Public code/template asset; team license only to extent team-authored. Copied snippets/upstream provenance not established here. |
| `src/assets/mourn-walllet (Copy)` | Maintainer explicitly confirms team ownership of the wallet artwork; see `NOTICE.md`. Covered by the team-original-work AGPL-3.0-only statement, not independently audited authorship. |
| `src/assets/mourn-walllet.png` | Maintainer explicitly confirms team ownership of the wallet artwork; see `NOTICE.md`. Covered by the team-original-work AGPL-3.0-only statement, not independently audited authorship. |
| `src/assets/mournLogoprot1.svg` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src/assets/quasar-logo-vertical.svg` | Third-party Quasar branding; no application consumer found in the bounded review, but retained in source snapshots. Artwork provenance/license not established by framework MIT alone; trademark rights are separate, not a finding that every nominative use needs permission. |
| `src-tauri/icons/128x128.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/128x128@2x.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/32x32.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square107x107Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square142x142Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square150x150Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square284x284Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square30x30Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square310x310Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square44x44Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square71x71Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/Square89x89Logo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/StoreLogo.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/icon.icns` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/icon.ico` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |
| `src-tauri/icons/icon.png` | Logo/icon candidate; map team-original approval to this exact file and record derivation/third-party inputs. Trademark rights separate. |

## Signal protocol inspiration versus copied code

`src/crypto/ratchet.ts` calls the implementation Double-Ratchet-style, not Signal-compatible, references a Signal paper step, and says its custom KDF differs from Signal’s HKDF construction. Protocol inspiration and references do not establish copied code. No libsignal dependency appears in the root direct manifests inspected. This is not proof that no Signal implementation was copied: any borrowed code must be traced to its exact upstream version, copyright and license separately. Do not attribute Signal implementation ownership to Mourn or infer an upstream software license from the protocol alone.

## Rust: lockfile plus cached registry-source inventory

Lockfile: `src-tauri/Cargo.lock` (563 total package entries, including this project). `CARGO_CACHE/<name>-<version>/...` is a portable placeholder for an already-cached crates.io registry source directory, not a repository path or a promise to ship that cache. Each row below is one lock entry; license declarations come from its cached `Cargo.toml`, never guessed from a crate name. Cache-relative source/notice paths preserve the observations without disclosing a reviewer’s local filesystem; uncached entries remain explicit. Direct declarations are in `src-tauri/Cargo.toml`; `tauri-build` is build-time and `libc` Linux-targeted.

**413 registry entries have cached manifests; 149 have no cached source.** Cross-platform and build dependencies are included; this table does not establish which are linked or bundled. MPL-2.0-only declarations observed for cssparser, cssparser-macros, dtoa-short, option-ext and selectors require file-level/source review, including any incompatibility notice; they are not automatically a whole-application copyleft finding. `ring` and other combined-license expressions require preserving all applicable notices. Unicode/LLVM-exception texts and embedded third-party code must not be discarded.

`rusqlite` enables `bundled`: cached libsqlite3-sys source and SQLite notices must be considered, not just the Rust wrapper license. `native-tls`, OpenSSL, GTK/WebKit/GStreamer and platform frameworks can add native redistribution obligations outside Cargo metadata. No system-library/installer payload clearance was performed.

| Crate | Locked version | Cached license declaration | Cached manifest and observed notice paths |
| --- | --- | --- | --- |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | `CARGO_CACHE/adler2-2.0.1/Cargo.toml`; `CARGO_CACHE/adler2-2.0.1/LICENSE-0BSD`; `CARGO_CACHE/adler2-2.0.1/LICENSE-APACHE`; `CARGO_CACHE/adler2-2.0.1/LICENSE-MIT` |
| ahash | 0.8.12 | MIT OR Apache-2.0 | `CARGO_CACHE/ahash-0.8.12/Cargo.toml`; `CARGO_CACHE/ahash-0.8.12/LICENSE-APACHE`; `CARGO_CACHE/ahash-0.8.12/LICENSE-MIT` |
| aho-corasick | 1.1.5 | Unlicense OR MIT | `CARGO_CACHE/aho-corasick-1.1.5/Cargo.toml`; `CARGO_CACHE/aho-corasick-1.1.5/COPYING`; `CARGO_CACHE/aho-corasick-1.1.5/LICENSE-MIT`; `CARGO_CACHE/aho-corasick-1.1.5/UNLICENSE` |
| alloc-no-stdlib | 2.0.4 | BSD-3-Clause | `CARGO_CACHE/alloc-no-stdlib-2.0.4/Cargo.toml`; `CARGO_CACHE/alloc-no-stdlib-2.0.4/LICENSE` |
| alloc-stdlib | 0.2.4 | BSD-3-Clause | `CARGO_CACHE/alloc-stdlib-0.2.4/Cargo.toml`; no root notice found |
| android_system_properties | 0.1.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| anyhow | 1.0.104 | MIT OR Apache-2.0 | `CARGO_CACHE/anyhow-1.0.104/Cargo.toml`; `CARGO_CACHE/anyhow-1.0.104/LICENSE-APACHE`; `CARGO_CACHE/anyhow-1.0.104/LICENSE-MIT` |
| arbitrary | 1.4.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| async-broadcast | 0.7.2 | MIT OR Apache-2.0 | `CARGO_CACHE/async-broadcast-0.7.2/Cargo.toml`; `CARGO_CACHE/async-broadcast-0.7.2/LICENSE-APACHE`; `CARGO_CACHE/async-broadcast-0.7.2/LICENSE-MIT` |
| async-channel | 2.5.0 | Apache-2.0 OR MIT | `CARGO_CACHE/async-channel-2.5.0/Cargo.toml`; `CARGO_CACHE/async-channel-2.5.0/LICENSE-APACHE`; `CARGO_CACHE/async-channel-2.5.0/LICENSE-MIT` |
| async-executor | 1.14.0 | Apache-2.0 OR MIT | `CARGO_CACHE/async-executor-1.14.0/Cargo.toml`; `CARGO_CACHE/async-executor-1.14.0/LICENSE-APACHE`; `CARGO_CACHE/async-executor-1.14.0/LICENSE-MIT` |
| async-io | 2.6.0 | Apache-2.0 OR MIT | `CARGO_CACHE/async-io-2.6.0/Cargo.toml`; `CARGO_CACHE/async-io-2.6.0/LICENSE-APACHE`; `CARGO_CACHE/async-io-2.6.0/LICENSE-MIT` |
| async-lock | 3.4.2 | Apache-2.0 OR MIT | `CARGO_CACHE/async-lock-3.4.2/Cargo.toml`; `CARGO_CACHE/async-lock-3.4.2/LICENSE-APACHE`; `CARGO_CACHE/async-lock-3.4.2/LICENSE-MIT` |
| async-process | 2.5.0 | Apache-2.0 OR MIT | `CARGO_CACHE/async-process-2.5.0/Cargo.toml`; `CARGO_CACHE/async-process-2.5.0/LICENSE-APACHE`; `CARGO_CACHE/async-process-2.5.0/LICENSE-MIT` |
| async-recursion | 1.1.1 | MIT OR Apache-2.0 | `CARGO_CACHE/async-recursion-1.1.1/Cargo.toml`; `CARGO_CACHE/async-recursion-1.1.1/LICENSE-APACHE`; `CARGO_CACHE/async-recursion-1.1.1/LICENSE-MIT` |
| async-signal | 0.2.14 | Apache-2.0 OR MIT | `CARGO_CACHE/async-signal-0.2.14/Cargo.toml`; `CARGO_CACHE/async-signal-0.2.14/LICENSE-APACHE`; `CARGO_CACHE/async-signal-0.2.14/LICENSE-MIT` |
| async-task | 4.7.1 | Apache-2.0 OR MIT | `CARGO_CACHE/async-task-4.7.1/Cargo.toml`; `CARGO_CACHE/async-task-4.7.1/LICENSE-APACHE`; `CARGO_CACHE/async-task-4.7.1/LICENSE-MIT` |
| async-trait | 0.1.92 | MIT OR Apache-2.0 | `CARGO_CACHE/async-trait-0.1.92/Cargo.toml`; `CARGO_CACHE/async-trait-0.1.92/LICENSE-APACHE`; `CARGO_CACHE/async-trait-0.1.92/LICENSE-MIT` |
| atk | 0.18.2 | MIT | `CARGO_CACHE/atk-0.18.2/Cargo.toml`; `CARGO_CACHE/atk-0.18.2/COPYRIGHT`; `CARGO_CACHE/atk-0.18.2/LICENSE` |
| atk-sys | 0.18.2 | MIT | `CARGO_CACHE/atk-sys-0.18.2/Cargo.toml`; `CARGO_CACHE/atk-sys-0.18.2/LICENSE` |
| atomic-waker | 1.1.2 | Apache-2.0 OR MIT | `CARGO_CACHE/atomic-waker-1.1.2/Cargo.toml`; `CARGO_CACHE/atomic-waker-1.1.2/LICENSE-APACHE`; `CARGO_CACHE/atomic-waker-1.1.2/LICENSE-MIT`; `CARGO_CACHE/atomic-waker-1.1.2/LICENSE-THIRD-PARTY` |
| autocfg | 1.5.1 | Apache-2.0 OR MIT | `CARGO_CACHE/autocfg-1.5.1/Cargo.toml`; `CARGO_CACHE/autocfg-1.5.1/LICENSE-APACHE`; `CARGO_CACHE/autocfg-1.5.1/LICENSE-MIT` |
| base64 | 0.21.7 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| base64 | 0.22.1 | MIT OR Apache-2.0 | `CARGO_CACHE/base64-0.22.1/Cargo.toml`; `CARGO_CACHE/base64-0.22.1/LICENSE-APACHE`; `CARGO_CACHE/base64-0.22.1/LICENSE-MIT` |
| bit-set | 0.8.0 | Apache-2.0 OR MIT | `CARGO_CACHE/bit-set-0.8.0/Cargo.toml`; `CARGO_CACHE/bit-set-0.8.0/LICENSE-APACHE`; `CARGO_CACHE/bit-set-0.8.0/LICENSE-MIT` |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT | `CARGO_CACHE/bit-vec-0.8.0/Cargo.toml`; `CARGO_CACHE/bit-vec-0.8.0/LICENSE-APACHE`; `CARGO_CACHE/bit-vec-0.8.0/LICENSE-MIT` |
| bitflags | 1.3.2 | MIT/Apache-2.0 | `CARGO_CACHE/bitflags-1.3.2/Cargo.toml`; `CARGO_CACHE/bitflags-1.3.2/LICENSE-APACHE`; `CARGO_CACHE/bitflags-1.3.2/LICENSE-MIT` |
| bitflags | 2.13.1 | MIT OR Apache-2.0 | `CARGO_CACHE/bitflags-2.13.1/Cargo.toml`; `CARGO_CACHE/bitflags-2.13.1/LICENSE-APACHE`; `CARGO_CACHE/bitflags-2.13.1/LICENSE-MIT` |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 | `CARGO_CACHE/block-buffer-0.10.4/Cargo.toml`; `CARGO_CACHE/block-buffer-0.10.4/LICENSE-APACHE`; `CARGO_CACHE/block-buffer-0.10.4/LICENSE-MIT` |
| block2 | 0.6.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| blocking | 1.6.2 | Apache-2.0 OR MIT | `CARGO_CACHE/blocking-1.6.2/Cargo.toml`; `CARGO_CACHE/blocking-1.6.2/LICENSE-APACHE`; `CARGO_CACHE/blocking-1.6.2/LICENSE-MIT` |
| brotli | 8.0.4 | BSD-3-Clause AND MIT | `CARGO_CACHE/brotli-8.0.4/Cargo.toml`; `CARGO_CACHE/brotli-8.0.4/LICENSE.BSD-3-Clause`; `CARGO_CACHE/brotli-8.0.4/LICENSE.MIT` |
| brotli-decompressor | 5.0.3 | BSD-3-Clause/MIT | `CARGO_CACHE/brotli-decompressor-5.0.3/Cargo.toml`; `CARGO_CACHE/brotli-decompressor-5.0.3/LICENSE` |
| bs58 | 0.5.1 | MIT/Apache-2.0 | `CARGO_CACHE/bs58-0.5.1/Cargo.toml`; `CARGO_CACHE/bs58-0.5.1/LICENSE-APACHE`; `CARGO_CACHE/bs58-0.5.1/LICENSE-MIT` |
| bumpalo | 3.20.3 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| bytemuck | 1.25.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| byteorder | 1.5.0 | Unlicense OR MIT | `CARGO_CACHE/byteorder-1.5.0/Cargo.toml`; `CARGO_CACHE/byteorder-1.5.0/COPYING`; `CARGO_CACHE/byteorder-1.5.0/LICENSE-MIT`; `CARGO_CACHE/byteorder-1.5.0/UNLICENSE` |
| bytes | 1.12.1 | MIT | `CARGO_CACHE/bytes-1.12.1/Cargo.toml`; `CARGO_CACHE/bytes-1.12.1/LICENSE` |
| cairo-rs | 0.18.5 | MIT | `CARGO_CACHE/cairo-rs-0.18.5/Cargo.toml`; `CARGO_CACHE/cairo-rs-0.18.5/COPYRIGHT`; `CARGO_CACHE/cairo-rs-0.18.5/LICENSE` |
| cairo-sys-rs | 0.18.2 | MIT | `CARGO_CACHE/cairo-sys-rs-0.18.2/Cargo.toml`; `CARGO_CACHE/cairo-sys-rs-0.18.2/LICENSE` |
| camino | 1.2.5 | MIT OR Apache-2.0 | `CARGO_CACHE/camino-1.2.5/Cargo.toml`; `CARGO_CACHE/camino-1.2.5/LICENSE-APACHE`; `CARGO_CACHE/camino-1.2.5/LICENSE-MIT` |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 | `CARGO_CACHE/cargo-platform-0.1.9/Cargo.toml`; `CARGO_CACHE/cargo-platform-0.1.9/LICENSE-APACHE`; `CARGO_CACHE/cargo-platform-0.1.9/LICENSE-MIT` |
| cargo_metadata | 0.19.2 | MIT | `CARGO_CACHE/cargo_metadata-0.19.2/Cargo.toml`; `CARGO_CACHE/cargo_metadata-0.19.2/LICENSE-MIT` |
| cargo_toml | 0.22.3 | Apache-2.0 OR MIT | `CARGO_CACHE/cargo_toml-0.22.3/Cargo.toml`; `CARGO_CACHE/cargo_toml-0.22.3/LICENSE` |
| cc | 1.4.3 | MIT OR Apache-2.0 | `CARGO_CACHE/cc-1.4.3/Cargo.toml`; `CARGO_CACHE/cc-1.4.3/LICENSE-APACHE`; `CARGO_CACHE/cc-1.4.3/LICENSE-MIT` |
| cesu8 | 1.1.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| cfb | 0.7.3 | MIT | `CARGO_CACHE/cfb-0.7.3/Cargo.toml`; `CARGO_CACHE/cfb-0.7.3/LICENSE` |
| cfg-expr | 0.15.8 | MIT OR Apache-2.0 | `CARGO_CACHE/cfg-expr-0.15.8/Cargo.toml`; `CARGO_CACHE/cfg-expr-0.15.8/LICENSE-APACHE`; `CARGO_CACHE/cfg-expr-0.15.8/LICENSE-MIT` |
| cfg-if | 1.0.4 | MIT OR Apache-2.0 | `CARGO_CACHE/cfg-if-1.0.4/Cargo.toml`; `CARGO_CACHE/cfg-if-1.0.4/LICENSE-APACHE`; `CARGO_CACHE/cfg-if-1.0.4/LICENSE-MIT` |
| chrono | 0.4.45 | MIT OR Apache-2.0 | `CARGO_CACHE/chrono-0.4.45/Cargo.toml`; `CARGO_CACHE/chrono-0.4.45/LICENSE.txt` |
| combine | 4.6.7 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| concurrent-queue | 2.5.0 | Apache-2.0 OR MIT | `CARGO_CACHE/concurrent-queue-2.5.0/Cargo.toml`; `CARGO_CACHE/concurrent-queue-2.5.0/LICENSE-APACHE`; `CARGO_CACHE/concurrent-queue-2.5.0/LICENSE-MIT` |
| cookie | 0.18.2 | MIT OR Apache-2.0 | `CARGO_CACHE/cookie-0.18.2/Cargo.toml`; `CARGO_CACHE/cookie-0.18.2/LICENSE-APACHE`; `CARGO_CACHE/cookie-0.18.2/LICENSE-MIT` |
| cookie_store | 0.22.1 | MIT OR Apache-2.0 | `CARGO_CACHE/cookie_store-0.22.1/Cargo.toml`; `CARGO_CACHE/cookie_store-0.22.1/LICENSE-APACHE`; `CARGO_CACHE/cookie_store-0.22.1/LICENSE-MIT` |
| core-foundation | 0.9.4 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| core-foundation | 0.10.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| core-foundation-sys | 0.8.7 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| core-graphics | 0.25.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| core-graphics-types | 0.2.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 | `CARGO_CACHE/cpufeatures-0.2.17/Cargo.toml`; `CARGO_CACHE/cpufeatures-0.2.17/LICENSE-APACHE`; `CARGO_CACHE/cpufeatures-0.2.17/LICENSE-MIT` |
| crc32fast | 1.5.0 | MIT OR Apache-2.0 | `CARGO_CACHE/crc32fast-1.5.0/Cargo.toml`; `CARGO_CACHE/crc32fast-1.5.0/LICENSE-APACHE`; `CARGO_CACHE/crc32fast-1.5.0/LICENSE-MIT` |
| crossbeam-channel | 0.5.16 | MIT OR Apache-2.0 | `CARGO_CACHE/crossbeam-channel-0.5.16/Cargo.toml`; `CARGO_CACHE/crossbeam-channel-0.5.16/LICENSE-APACHE`; `CARGO_CACHE/crossbeam-channel-0.5.16/LICENSE-MIT`; `CARGO_CACHE/crossbeam-channel-0.5.16/LICENSE-THIRD-PARTY` |
| crossbeam-utils | 0.8.22 | MIT OR Apache-2.0 | `CARGO_CACHE/crossbeam-utils-0.8.22/Cargo.toml`; `CARGO_CACHE/crossbeam-utils-0.8.22/LICENSE-APACHE`; `CARGO_CACHE/crossbeam-utils-0.8.22/LICENSE-MIT` |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 | `CARGO_CACHE/crypto-common-0.1.7/Cargo.toml`; `CARGO_CACHE/crypto-common-0.1.7/LICENSE-APACHE`; `CARGO_CACHE/crypto-common-0.1.7/LICENSE-MIT` |
| cssparser | 0.36.0 | MPL-2.0 | `CARGO_CACHE/cssparser-0.36.0/Cargo.toml`; `CARGO_CACHE/cssparser-0.36.0/LICENSE` |
| cssparser-macros | 0.6.1 | MPL-2.0 | `CARGO_CACHE/cssparser-macros-0.6.1/Cargo.toml`; `CARGO_CACHE/cssparser-macros-0.6.1/LICENSE` |
| ctor | 0.8.0 | Apache-2.0 OR MIT | `CARGO_CACHE/ctor-0.8.0/Cargo.toml`; `CARGO_CACHE/ctor-0.8.0/LICENSE-APACHE`; `CARGO_CACHE/ctor-0.8.0/LICENSE-MIT` |
| ctor-proc-macro | 0.0.7 | Apache-2.0 OR MIT | `CARGO_CACHE/ctor-proc-macro-0.0.7/Cargo.toml`; `CARGO_CACHE/ctor-proc-macro-0.0.7/LICENSE-APACHE`; `CARGO_CACHE/ctor-proc-macro-0.0.7/LICENSE-MIT` |
| darling | 0.23.0 | MIT | `CARGO_CACHE/darling-0.23.0/Cargo.toml`; `CARGO_CACHE/darling-0.23.0/LICENSE` |
| darling_core | 0.23.0 | MIT | `CARGO_CACHE/darling_core-0.23.0/Cargo.toml`; `CARGO_CACHE/darling_core-0.23.0/LICENSE` |
| darling_macro | 0.23.0 | MIT | `CARGO_CACHE/darling_macro-0.23.0/Cargo.toml`; `CARGO_CACHE/darling_macro-0.23.0/LICENSE` |
| dbus | 0.9.12 | Apache-2.0/MIT | `CARGO_CACHE/dbus-0.9.12/Cargo.toml`; `CARGO_CACHE/dbus-0.9.12/LICENSE-APACHE`; `CARGO_CACHE/dbus-0.9.12/LICENSE-MIT` |
| dbus-secret-service | 4.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/dbus-secret-service-4.1.0/Cargo.toml`; `CARGO_CACHE/dbus-secret-service-4.1.0/LICENSE-APACHE`; `CARGO_CACHE/dbus-secret-service-4.1.0/LICENSE-MIT` |
| defmt | 1.1.1 | MIT OR Apache-2.0 | `CARGO_CACHE/defmt-1.1.1/Cargo.toml`; `CARGO_CACHE/defmt-1.1.1/LICENSE-APACHE`; `CARGO_CACHE/defmt-1.1.1/LICENSE-MIT` |
| defmt-macros | 1.1.1 | MIT OR Apache-2.0 | `CARGO_CACHE/defmt-macros-1.1.1/Cargo.toml`; `CARGO_CACHE/defmt-macros-1.1.1/LICENSE-APACHE`; `CARGO_CACHE/defmt-macros-1.1.1/LICENSE-MIT` |
| defmt-parser | 1.0.0 | MIT OR Apache-2.0 | `CARGO_CACHE/defmt-parser-1.0.0/Cargo.toml`; no root notice found |
| deranged | 0.5.8 | MIT OR Apache-2.0 | `CARGO_CACHE/deranged-0.5.8/Cargo.toml`; `CARGO_CACHE/deranged-0.5.8/LICENSE-Apache`; `CARGO_CACHE/deranged-0.5.8/LICENSE-MIT` |
| derive_arbitrary | 1.4.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| derive_more | 2.1.1 | MIT | `CARGO_CACHE/derive_more-2.1.1/Cargo.toml`; `CARGO_CACHE/derive_more-2.1.1/LICENSE` |
| derive_more-impl | 2.1.1 | MIT | `CARGO_CACHE/derive_more-impl-2.1.1/Cargo.toml`; `CARGO_CACHE/derive_more-impl-2.1.1/LICENSE` |
| digest | 0.10.7 | MIT OR Apache-2.0 | `CARGO_CACHE/digest-0.10.7/Cargo.toml`; `CARGO_CACHE/digest-0.10.7/LICENSE-APACHE`; `CARGO_CACHE/digest-0.10.7/LICENSE-MIT` |
| dirs | 6.0.0 | MIT OR Apache-2.0 | `CARGO_CACHE/dirs-6.0.0/Cargo.toml`; `CARGO_CACHE/dirs-6.0.0/LICENSE-APACHE`; `CARGO_CACHE/dirs-6.0.0/LICENSE-MIT` |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 | `CARGO_CACHE/dirs-sys-0.5.0/Cargo.toml`; `CARGO_CACHE/dirs-sys-0.5.0/LICENSE-APACHE`; `CARGO_CACHE/dirs-sys-0.5.0/LICENSE-MIT` |
| discord-rich-presence | 1.1.0 | MIT | `CARGO_CACHE/discord-rich-presence-1.1.0/Cargo.toml`; `CARGO_CACHE/discord-rich-presence-1.1.0/LICENSE` |
| dispatch2 | 0.3.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 | `CARGO_CACHE/displaydoc-0.2.7/Cargo.toml`; `CARGO_CACHE/displaydoc-0.2.7/LICENSE-APACHE`; `CARGO_CACHE/displaydoc-0.2.7/LICENSE-MIT` |
| dlopen2 | 0.8.2 | MIT | `CARGO_CACHE/dlopen2-0.8.2/Cargo.toml`; no root notice found |
| dlopen2_derive | 0.4.3 | MIT | `CARGO_CACHE/dlopen2_derive-0.4.3/Cargo.toml`; no root notice found |
| document-features | 0.2.12 | MIT OR Apache-2.0 | `CARGO_CACHE/document-features-0.2.12/Cargo.toml`; `CARGO_CACHE/document-features-0.2.12/LICENSE-APACHE`; `CARGO_CACHE/document-features-0.2.12/LICENSE-MIT` |
| dom_query | 0.27.0 | MIT | `CARGO_CACHE/dom_query-0.27.0/Cargo.toml`; `CARGO_CACHE/dom_query-0.27.0/LICENSE` |
| dpi | 0.1.2 | Apache-2.0 AND MIT | `CARGO_CACHE/dpi-0.1.2/Cargo.toml`; `CARGO_CACHE/dpi-0.1.2/LICENSE`; `CARGO_CACHE/dpi-0.1.2/LICENSE-LIBM-MIT` |
| dtoa | 1.0.11 | MIT OR Apache-2.0 | `CARGO_CACHE/dtoa-1.0.11/Cargo.toml`; `CARGO_CACHE/dtoa-1.0.11/LICENSE-APACHE`; `CARGO_CACHE/dtoa-1.0.11/LICENSE-MIT` |
| dtoa-short | 0.3.5 | MPL-2.0 | `CARGO_CACHE/dtoa-short-0.3.5/Cargo.toml`; `CARGO_CACHE/dtoa-short-0.3.5/LICENSE` |
| dtor | 0.3.0 | Apache-2.0 OR MIT | `CARGO_CACHE/dtor-0.3.0/Cargo.toml`; `CARGO_CACHE/dtor-0.3.0/LICENSE-APACHE`; `CARGO_CACHE/dtor-0.3.0/LICENSE-MIT` |
| dtor-proc-macro | 0.0.6 | Apache-2.0 OR MIT | `CARGO_CACHE/dtor-proc-macro-0.0.6/Cargo.toml`; `CARGO_CACHE/dtor-proc-macro-0.0.6/LICENSE-APACHE`; `CARGO_CACHE/dtor-proc-macro-0.0.6/LICENSE-MIT` |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | `CARGO_CACHE/dunce-1.0.5/Cargo.toml`; `CARGO_CACHE/dunce-1.0.5/LICENSE` |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 | `CARGO_CACHE/dyn-clone-1.0.20/Cargo.toml`; `CARGO_CACHE/dyn-clone-1.0.20/LICENSE-APACHE`; `CARGO_CACHE/dyn-clone-1.0.20/LICENSE-MIT` |
| embed-resource | 3.0.11 | MIT | `CARGO_CACHE/embed-resource-3.0.11/Cargo.toml`; `CARGO_CACHE/embed-resource-3.0.11/LICENSE` |
| embed_plist | 1.2.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| encoding_rs | 0.8.35 | (Apache-2.0 OR MIT) AND BSD-3-Clause | `CARGO_CACHE/encoding_rs-0.8.35/Cargo.toml`; `CARGO_CACHE/encoding_rs-0.8.35/COPYRIGHT`; `CARGO_CACHE/encoding_rs-0.8.35/LICENSE-APACHE`; `CARGO_CACHE/encoding_rs-0.8.35/LICENSE-MIT`; `CARGO_CACHE/encoding_rs-0.8.35/LICENSE-WHATWG` |
| endi | 1.1.1 | MIT | `CARGO_CACHE/endi-1.1.1/Cargo.toml`; `CARGO_CACHE/endi-1.1.1/LICENSE-MIT` |
| enumflags2 | 0.7.12 | MIT OR Apache-2.0 | `CARGO_CACHE/enumflags2-0.7.12/Cargo.toml`; `CARGO_CACHE/enumflags2-0.7.12/LICENSE-APACHE`; `CARGO_CACHE/enumflags2-0.7.12/LICENSE-MIT` |
| enumflags2_derive | 0.7.12 | MIT OR Apache-2.0 | `CARGO_CACHE/enumflags2_derive-0.7.12/Cargo.toml`; `CARGO_CACHE/enumflags2_derive-0.7.12/LICENSE-APACHE`; `CARGO_CACHE/enumflags2_derive-0.7.12/LICENSE-MIT` |
| equivalent | 1.0.2 | Apache-2.0 OR MIT | `CARGO_CACHE/equivalent-1.0.2/Cargo.toml`; `CARGO_CACHE/equivalent-1.0.2/LICENSE-APACHE`; `CARGO_CACHE/equivalent-1.0.2/LICENSE-MIT` |
| erased-serde | 0.4.10 | MIT OR Apache-2.0 | `CARGO_CACHE/erased-serde-0.4.10/Cargo.toml`; `CARGO_CACHE/erased-serde-0.4.10/LICENSE-APACHE`; `CARGO_CACHE/erased-serde-0.4.10/LICENSE-MIT` |
| errno | 0.3.14 | MIT OR Apache-2.0 | `CARGO_CACHE/errno-0.3.14/Cargo.toml`; `CARGO_CACHE/errno-0.3.14/LICENSE-APACHE`; `CARGO_CACHE/errno-0.3.14/LICENSE-MIT` |
| event-listener | 5.4.2 | Apache-2.0 OR MIT | `CARGO_CACHE/event-listener-5.4.2/Cargo.toml`; `CARGO_CACHE/event-listener-5.4.2/LICENSE-APACHE`; `CARGO_CACHE/event-listener-5.4.2/LICENSE-MIT` |
| event-listener-strategy | 0.5.4 | Apache-2.0 OR MIT | `CARGO_CACHE/event-listener-strategy-0.5.4/Cargo.toml`; `CARGO_CACHE/event-listener-strategy-0.5.4/LICENSE-APACHE`; `CARGO_CACHE/event-listener-strategy-0.5.4/LICENSE-MIT` |
| fallible-iterator | 0.3.0 | MIT/Apache-2.0 | `CARGO_CACHE/fallible-iterator-0.3.0/Cargo.toml`; `CARGO_CACHE/fallible-iterator-0.3.0/LICENSE-APACHE`; `CARGO_CACHE/fallible-iterator-0.3.0/LICENSE-MIT` |
| fallible-streaming-iterator | 0.1.9 | MIT/Apache-2.0 | `CARGO_CACHE/fallible-streaming-iterator-0.1.9/Cargo.toml`; `CARGO_CACHE/fallible-streaming-iterator-0.1.9/LICENSE-APACHE`; `CARGO_CACHE/fallible-streaming-iterator-0.1.9/LICENSE-MIT` |
| fastrand | 2.5.0 | Apache-2.0 OR MIT | `CARGO_CACHE/fastrand-2.5.0/Cargo.toml`; `CARGO_CACHE/fastrand-2.5.0/LICENSE-APACHE`; `CARGO_CACHE/fastrand-2.5.0/LICENSE-MIT` |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 | `CARGO_CACHE/fdeflate-0.3.7/Cargo.toml`; `CARGO_CACHE/fdeflate-0.3.7/LICENSE-APACHE`; `CARGO_CACHE/fdeflate-0.3.7/LICENSE-MIT` |
| field-offset | 0.3.6 | MIT OR Apache-2.0 | `CARGO_CACHE/field-offset-0.3.6/Cargo.toml`; `CARGO_CACHE/field-offset-0.3.6/LICENSE-APACHE`; `CARGO_CACHE/field-offset-0.3.6/LICENSE-MIT` |
| filetime | 0.2.29 | MIT/Apache-2.0 | `CARGO_CACHE/filetime-0.2.29/Cargo.toml`; `CARGO_CACHE/filetime-0.2.29/LICENSE-APACHE`; `CARGO_CACHE/filetime-0.2.29/LICENSE-MIT` |
| find-msvc-tools | 0.1.11 | MIT OR Apache-2.0 | `CARGO_CACHE/find-msvc-tools-0.1.11/Cargo.toml`; `CARGO_CACHE/find-msvc-tools-0.1.11/LICENSE-APACHE`; `CARGO_CACHE/find-msvc-tools-0.1.11/LICENSE-MIT` |
| flate2 | 1.1.9 | MIT OR Apache-2.0 | `CARGO_CACHE/flate2-1.1.9/Cargo.toml`; `CARGO_CACHE/flate2-1.1.9/LICENSE-APACHE`; `CARGO_CACHE/flate2-1.1.9/LICENSE-MIT` |
| fnv | 1.0.7 | Apache-2.0 / MIT | `CARGO_CACHE/fnv-1.0.7/Cargo.toml`; `CARGO_CACHE/fnv-1.0.7/LICENSE-APACHE`; `CARGO_CACHE/fnv-1.0.7/LICENSE-MIT` |
| foldhash | 0.2.0 | Zlib | `CARGO_CACHE/foldhash-0.2.0/Cargo.toml`; `CARGO_CACHE/foldhash-0.2.0/LICENSE` |
| foreign-types | 0.3.2 | MIT/Apache-2.0 | `CARGO_CACHE/foreign-types-0.3.2/Cargo.toml`; `CARGO_CACHE/foreign-types-0.3.2/LICENSE-APACHE`; `CARGO_CACHE/foreign-types-0.3.2/LICENSE-MIT` |
| foreign-types | 0.5.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| foreign-types-macros | 0.2.4 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| foreign-types-shared | 0.1.1 | MIT/Apache-2.0 | `CARGO_CACHE/foreign-types-shared-0.1.1/Cargo.toml`; `CARGO_CACHE/foreign-types-shared-0.1.1/LICENSE-APACHE`; `CARGO_CACHE/foreign-types-shared-0.1.1/LICENSE-MIT` |
| foreign-types-shared | 0.3.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 | `CARGO_CACHE/form_urlencoded-1.2.2/Cargo.toml`; `CARGO_CACHE/form_urlencoded-1.2.2/LICENSE-APACHE`; `CARGO_CACHE/form_urlencoded-1.2.2/LICENSE-MIT` |
| futures-channel | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/futures-channel-0.3.34/Cargo.toml`; `CARGO_CACHE/futures-channel-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/futures-channel-0.3.34/LICENSE-MIT` |
| futures-core | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/futures-core-0.3.34/Cargo.toml`; `CARGO_CACHE/futures-core-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/futures-core-0.3.34/LICENSE-MIT` |
| futures-executor | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/futures-executor-0.3.34/Cargo.toml`; `CARGO_CACHE/futures-executor-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/futures-executor-0.3.34/LICENSE-MIT` |
| futures-io | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/futures-io-0.3.34/Cargo.toml`; `CARGO_CACHE/futures-io-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/futures-io-0.3.34/LICENSE-MIT` |
| futures-lite | 2.6.1 | Apache-2.0 OR MIT | `CARGO_CACHE/futures-lite-2.6.1/Cargo.toml`; `CARGO_CACHE/futures-lite-2.6.1/LICENSE-APACHE`; `CARGO_CACHE/futures-lite-2.6.1/LICENSE-MIT`; `CARGO_CACHE/futures-lite-2.6.1/LICENSE-THIRD-PARTY` |
| futures-macro | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/futures-macro-0.3.34/Cargo.toml`; `CARGO_CACHE/futures-macro-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/futures-macro-0.3.34/LICENSE-MIT` |
| futures-sink | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/futures-sink-0.3.34/Cargo.toml`; `CARGO_CACHE/futures-sink-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/futures-sink-0.3.34/LICENSE-MIT` |
| futures-task | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/futures-task-0.3.34/Cargo.toml`; `CARGO_CACHE/futures-task-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/futures-task-0.3.34/LICENSE-MIT` |
| futures-util | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/futures-util-0.3.34/Cargo.toml`; `CARGO_CACHE/futures-util-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/futures-util-0.3.34/LICENSE-MIT` |
| gdk | 0.18.2 | MIT | `CARGO_CACHE/gdk-0.18.2/Cargo.toml`; `CARGO_CACHE/gdk-0.18.2/COPYRIGHT`; `CARGO_CACHE/gdk-0.18.2/LICENSE` |
| gdk-pixbuf | 0.18.5 | MIT | `CARGO_CACHE/gdk-pixbuf-0.18.5/Cargo.toml`; `CARGO_CACHE/gdk-pixbuf-0.18.5/COPYRIGHT`; `CARGO_CACHE/gdk-pixbuf-0.18.5/LICENSE` |
| gdk-pixbuf-sys | 0.18.0 | MIT | `CARGO_CACHE/gdk-pixbuf-sys-0.18.0/Cargo.toml`; `CARGO_CACHE/gdk-pixbuf-sys-0.18.0/LICENSE` |
| gdk-sys | 0.18.2 | MIT | `CARGO_CACHE/gdk-sys-0.18.2/Cargo.toml`; `CARGO_CACHE/gdk-sys-0.18.2/LICENSE` |
| gdkwayland-sys | 0.18.2 | MIT | `CARGO_CACHE/gdkwayland-sys-0.18.2/Cargo.toml`; `CARGO_CACHE/gdkwayland-sys-0.18.2/LICENSE` |
| gdkx11 | 0.18.2 | MIT | `CARGO_CACHE/gdkx11-0.18.2/Cargo.toml`; `CARGO_CACHE/gdkx11-0.18.2/COPYRIGHT`; `CARGO_CACHE/gdkx11-0.18.2/LICENSE` |
| gdkx11-sys | 0.18.2 | MIT | `CARGO_CACHE/gdkx11-sys-0.18.2/Cargo.toml`; `CARGO_CACHE/gdkx11-sys-0.18.2/LICENSE` |
| generic-array | 0.14.7 | MIT | `CARGO_CACHE/generic-array-0.14.7/Cargo.toml`; `CARGO_CACHE/generic-array-0.14.7/LICENSE` |
| getrandom | 0.2.17 | MIT OR Apache-2.0 | `CARGO_CACHE/getrandom-0.2.17/Cargo.toml`; `CARGO_CACHE/getrandom-0.2.17/LICENSE-APACHE`; `CARGO_CACHE/getrandom-0.2.17/LICENSE-MIT` |
| getrandom | 0.3.4 | MIT OR Apache-2.0 | `CARGO_CACHE/getrandom-0.3.4/Cargo.toml`; `CARGO_CACHE/getrandom-0.3.4/LICENSE-APACHE`; `CARGO_CACHE/getrandom-0.3.4/LICENSE-MIT` |
| getrandom | 0.4.3 | MIT OR Apache-2.0 | `CARGO_CACHE/getrandom-0.4.3/Cargo.toml`; `CARGO_CACHE/getrandom-0.4.3/LICENSE-APACHE`; `CARGO_CACHE/getrandom-0.4.3/LICENSE-MIT` |
| gio | 0.18.4 | MIT | `CARGO_CACHE/gio-0.18.4/Cargo.toml`; `CARGO_CACHE/gio-0.18.4/COPYRIGHT`; `CARGO_CACHE/gio-0.18.4/LICENSE` |
| gio-sys | 0.18.1 | MIT | `CARGO_CACHE/gio-sys-0.18.1/Cargo.toml`; `CARGO_CACHE/gio-sys-0.18.1/LICENSE` |
| glib | 0.18.5 | MIT | `CARGO_CACHE/glib-0.18.5/Cargo.toml`; `CARGO_CACHE/glib-0.18.5/COPYRIGHT`; `CARGO_CACHE/glib-0.18.5/LICENSE` |
| glib-macros | 0.18.5 | MIT | `CARGO_CACHE/glib-macros-0.18.5/Cargo.toml`; `CARGO_CACHE/glib-macros-0.18.5/COPYRIGHT`; `CARGO_CACHE/glib-macros-0.18.5/LICENSE` |
| glib-sys | 0.18.1 | MIT | `CARGO_CACHE/glib-sys-0.18.1/Cargo.toml`; `CARGO_CACHE/glib-sys-0.18.1/LICENSE` |
| glob | 0.3.4 | MIT OR Apache-2.0 | `CARGO_CACHE/glob-0.3.4/Cargo.toml`; `CARGO_CACHE/glob-0.3.4/LICENSE-APACHE`; `CARGO_CACHE/glob-0.3.4/LICENSE-MIT` |
| gobject-sys | 0.18.0 | MIT | `CARGO_CACHE/gobject-sys-0.18.0/Cargo.toml`; `CARGO_CACHE/gobject-sys-0.18.0/LICENSE` |
| gtk | 0.18.2 | MIT | `CARGO_CACHE/gtk-0.18.2/Cargo.toml`; `CARGO_CACHE/gtk-0.18.2/COPYRIGHT`; `CARGO_CACHE/gtk-0.18.2/LICENSE` |
| gtk-sys | 0.18.2 | MIT | `CARGO_CACHE/gtk-sys-0.18.2/Cargo.toml`; `CARGO_CACHE/gtk-sys-0.18.2/LICENSE` |
| gtk3-macros | 0.18.2 | MIT | `CARGO_CACHE/gtk3-macros-0.18.2/Cargo.toml`; `CARGO_CACHE/gtk3-macros-0.18.2/COPYRIGHT`; `CARGO_CACHE/gtk3-macros-0.18.2/LICENSE` |
| h2 | 0.4.15 | MIT | `CARGO_CACHE/h2-0.4.15/Cargo.toml`; `CARGO_CACHE/h2-0.4.15/LICENSE` |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 | `CARGO_CACHE/hashbrown-0.12.3/Cargo.toml`; `CARGO_CACHE/hashbrown-0.12.3/LICENSE-APACHE`; `CARGO_CACHE/hashbrown-0.12.3/LICENSE-MIT` |
| hashbrown | 0.14.5 | MIT OR Apache-2.0 | `CARGO_CACHE/hashbrown-0.14.5/Cargo.toml`; `CARGO_CACHE/hashbrown-0.14.5/LICENSE-APACHE`; `CARGO_CACHE/hashbrown-0.14.5/LICENSE-MIT` |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 | `CARGO_CACHE/hashbrown-0.17.1/Cargo.toml`; `CARGO_CACHE/hashbrown-0.17.1/LICENSE-APACHE`; `CARGO_CACHE/hashbrown-0.17.1/LICENSE-MIT` |
| hashlink | 0.9.1 | MIT OR Apache-2.0 | `CARGO_CACHE/hashlink-0.9.1/Cargo.toml`; `CARGO_CACHE/hashlink-0.9.1/LICENSE-APACHE`; `CARGO_CACHE/hashlink-0.9.1/LICENSE-MIT` |
| heck | 0.4.1 | MIT OR Apache-2.0 | `CARGO_CACHE/heck-0.4.1/Cargo.toml`; `CARGO_CACHE/heck-0.4.1/LICENSE-APACHE`; `CARGO_CACHE/heck-0.4.1/LICENSE-MIT` |
| heck | 0.5.0 | MIT OR Apache-2.0 | `CARGO_CACHE/heck-0.5.0/Cargo.toml`; `CARGO_CACHE/heck-0.5.0/LICENSE-APACHE`; `CARGO_CACHE/heck-0.5.0/LICENSE-MIT` |
| hermit-abi | 0.5.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| hex | 0.4.3 | MIT OR Apache-2.0 | `CARGO_CACHE/hex-0.4.3/Cargo.toml`; `CARGO_CACHE/hex-0.4.3/LICENSE-APACHE`; `CARGO_CACHE/hex-0.4.3/LICENSE-MIT` |
| html5ever | 0.38.0 | MIT OR Apache-2.0 | `CARGO_CACHE/html5ever-0.38.0/Cargo.toml`; `CARGO_CACHE/html5ever-0.38.0/LICENSE-APACHE`; `CARGO_CACHE/html5ever-0.38.0/LICENSE-MIT` |
| http | 1.5.0 | MIT OR Apache-2.0 | `CARGO_CACHE/http-1.5.0/Cargo.toml`; `CARGO_CACHE/http-1.5.0/LICENSE-APACHE`; `CARGO_CACHE/http-1.5.0/LICENSE-MIT` |
| http-body | 1.1.0 | MIT | `CARGO_CACHE/http-body-1.1.0/Cargo.toml`; `CARGO_CACHE/http-body-1.1.0/LICENSE` |
| http-body-util | 0.1.5 | MIT | `CARGO_CACHE/http-body-util-0.1.5/Cargo.toml`; `CARGO_CACHE/http-body-util-0.1.5/LICENSE` |
| httparse | 1.10.1 | MIT OR Apache-2.0 | `CARGO_CACHE/httparse-1.10.1/Cargo.toml`; `CARGO_CACHE/httparse-1.10.1/LICENSE-APACHE`; `CARGO_CACHE/httparse-1.10.1/LICENSE-MIT` |
| hyper | 1.11.0 | MIT | `CARGO_CACHE/hyper-1.11.0/Cargo.toml`; `CARGO_CACHE/hyper-1.11.0/LICENSE` |
| hyper-rustls | 0.27.9 | Apache-2.0 OR ISC OR MIT | `CARGO_CACHE/hyper-rustls-0.27.9/Cargo.toml`; `CARGO_CACHE/hyper-rustls-0.27.9/LICENSE-APACHE`; `CARGO_CACHE/hyper-rustls-0.27.9/LICENSE-ISC`; `CARGO_CACHE/hyper-rustls-0.27.9/LICENSE-MIT` |
| hyper-tls | 0.6.0 | MIT/Apache-2.0 | `CARGO_CACHE/hyper-tls-0.6.0/Cargo.toml`; `CARGO_CACHE/hyper-tls-0.6.0/LICENSE-APACHE`; `CARGO_CACHE/hyper-tls-0.6.0/LICENSE-MIT` |
| hyper-util | 0.1.20 | MIT | `CARGO_CACHE/hyper-util-0.1.20/Cargo.toml`; `CARGO_CACHE/hyper-util-0.1.20/LICENSE` |
| iana-time-zone | 0.1.65 | MIT OR Apache-2.0 | `CARGO_CACHE/iana-time-zone-0.1.65/Cargo.toml`; `CARGO_CACHE/iana-time-zone-0.1.65/LICENSE-APACHE`; `CARGO_CACHE/iana-time-zone-0.1.65/LICENSE-MIT` |
| iana-time-zone-haiku | 0.1.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| ico | 0.5.0 | MIT | `CARGO_CACHE/ico-0.5.0/Cargo.toml`; `CARGO_CACHE/ico-0.5.0/LICENSE` |
| icu_collections | 2.3.0 | Unicode-3.0 | `CARGO_CACHE/icu_collections-2.3.0/Cargo.toml`; `CARGO_CACHE/icu_collections-2.3.0/LICENSE` |
| icu_locale_core | 2.3.0 | Unicode-3.0 | `CARGO_CACHE/icu_locale_core-2.3.0/Cargo.toml`; `CARGO_CACHE/icu_locale_core-2.3.0/LICENSE` |
| icu_normalizer | 2.3.0 | Unicode-3.0 | `CARGO_CACHE/icu_normalizer-2.3.0/Cargo.toml`; `CARGO_CACHE/icu_normalizer-2.3.0/LICENSE` |
| icu_normalizer_data | 2.3.0 | Unicode-3.0 | `CARGO_CACHE/icu_normalizer_data-2.3.0/Cargo.toml`; `CARGO_CACHE/icu_normalizer_data-2.3.0/LICENSE` |
| icu_properties | 2.3.0 | Unicode-3.0 | `CARGO_CACHE/icu_properties-2.3.0/Cargo.toml`; `CARGO_CACHE/icu_properties-2.3.0/LICENSE` |
| icu_properties_data | 2.3.0 | Unicode-3.0 | `CARGO_CACHE/icu_properties_data-2.3.0/Cargo.toml`; `CARGO_CACHE/icu_properties_data-2.3.0/LICENSE` |
| icu_provider | 2.3.0 | Unicode-3.0 | `CARGO_CACHE/icu_provider-2.3.0/Cargo.toml`; `CARGO_CACHE/icu_provider-2.3.0/LICENSE` |
| ident_case | 1.0.1 | MIT/Apache-2.0 | `CARGO_CACHE/ident_case-1.0.1/Cargo.toml`; `CARGO_CACHE/ident_case-1.0.1/LICENSE` |
| idna | 1.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/idna-1.1.0/Cargo.toml`; `CARGO_CACHE/idna-1.1.0/LICENSE-APACHE`; `CARGO_CACHE/idna-1.1.0/LICENSE-MIT` |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT | `CARGO_CACHE/idna_adapter-1.2.2/Cargo.toml`; `CARGO_CACHE/idna_adapter-1.2.2/LICENSE-APACHE`; `CARGO_CACHE/idna_adapter-1.2.2/LICENSE-MIT` |
| indexmap | 1.9.3 | Apache-2.0 OR MIT | `CARGO_CACHE/indexmap-1.9.3/Cargo.toml`; `CARGO_CACHE/indexmap-1.9.3/LICENSE-APACHE`; `CARGO_CACHE/indexmap-1.9.3/LICENSE-MIT` |
| indexmap | 2.14.0 | Apache-2.0 OR MIT | `CARGO_CACHE/indexmap-2.14.0/Cargo.toml`; `CARGO_CACHE/indexmap-2.14.0/LICENSE-APACHE`; `CARGO_CACHE/indexmap-2.14.0/LICENSE-MIT` |
| infer | 0.19.0 | MIT | `CARGO_CACHE/infer-0.19.0/Cargo.toml`; `CARGO_CACHE/infer-0.19.0/LICENSE` |
| ipnet | 2.12.1 | MIT OR Apache-2.0 | `CARGO_CACHE/ipnet-2.12.1/Cargo.toml`; `CARGO_CACHE/ipnet-2.12.1/LICENSE-APACHE`; `CARGO_CACHE/ipnet-2.12.1/LICENSE-MIT` |
| is-docker | 0.2.0 | MIT | `CARGO_CACHE/is-docker-0.2.0/Cargo.toml`; `CARGO_CACHE/is-docker-0.2.0/LICENSE` |
| is-wsl | 0.4.0 | MIT | `CARGO_CACHE/is-wsl-0.4.0/Cargo.toml`; `CARGO_CACHE/is-wsl-0.4.0/LICENSE` |
| itoa | 1.0.18 | MIT OR Apache-2.0 | `CARGO_CACHE/itoa-1.0.18/Cargo.toml`; `CARGO_CACHE/itoa-1.0.18/LICENSE-APACHE`; `CARGO_CACHE/itoa-1.0.18/LICENSE-MIT` |
| javascriptcore-rs | 1.1.2 | MIT | `CARGO_CACHE/javascriptcore-rs-1.1.2/Cargo.toml`; `CARGO_CACHE/javascriptcore-rs-1.1.2/.license_template`; `CARGO_CACHE/javascriptcore-rs-1.1.2/LICENSE` |
| javascriptcore-rs-sys | 1.1.1 | MIT | `CARGO_CACHE/javascriptcore-rs-sys-1.1.1/Cargo.toml`; `CARGO_CACHE/javascriptcore-rs-sys-1.1.1/LICENSE` |
| jiff | 0.2.35 | Unlicense OR MIT | `CARGO_CACHE/jiff-0.2.35/Cargo.toml`; `CARGO_CACHE/jiff-0.2.35/COPYING`; `CARGO_CACHE/jiff-0.2.35/LICENSE-MIT`; `CARGO_CACHE/jiff-0.2.35/UNLICENSE` |
| jiff-core | 0.1.0 | Unlicense OR MIT | `CARGO_CACHE/jiff-core-0.1.0/Cargo.toml`; `CARGO_CACHE/jiff-core-0.1.0/COPYING`; `CARGO_CACHE/jiff-core-0.1.0/LICENSE-MIT`; `CARGO_CACHE/jiff-core-0.1.0/UNLICENSE` |
| jiff-static | 0.2.35 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| jiff-tzdb | 0.1.8 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| jiff-tzdb-platform | 0.1.3 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| jni | 0.21.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| jni | 0.22.4 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| jni-macros | 0.22.4 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| jni-sys | 0.3.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| jni-sys | 0.4.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| jni-sys-macros | 0.4.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| js-sys | 0.3.104 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| json-patch | 3.0.1 | MIT/Apache-2.0 | `CARGO_CACHE/json-patch-3.0.1/Cargo.toml`; `CARGO_CACHE/json-patch-3.0.1/LICENSE-APACHE`; `CARGO_CACHE/json-patch-3.0.1/LICENSE-MIT` |
| jsonptr | 0.6.3 | MIT OR Apache-2.0 | `CARGO_CACHE/jsonptr-0.6.3/Cargo.toml`; `CARGO_CACHE/jsonptr-0.6.3/LICENSE-APACHE`; `CARGO_CACHE/jsonptr-0.6.3/LICENSE-MIT` |
| keyboard-types | 0.7.0 | MIT OR Apache-2.0 | `CARGO_CACHE/keyboard-types-0.7.0/Cargo.toml`; `CARGO_CACHE/keyboard-types-0.7.0/LICENSE-APACHE`; `CARGO_CACHE/keyboard-types-0.7.0/LICENSE-MIT` |
| keyring | 3.6.3 | MIT OR Apache-2.0 | `CARGO_CACHE/keyring-3.6.3/Cargo.toml`; `CARGO_CACHE/keyring-3.6.3/LICENSE-APACHE`; `CARGO_CACHE/keyring-3.6.3/LICENSE-MIT` |
| libappindicator | 0.9.0 | Apache-2.0 OR MIT | `CARGO_CACHE/libappindicator-0.9.0/Cargo.toml`; `CARGO_CACHE/libappindicator-0.9.0/.license_template`; `CARGO_CACHE/libappindicator-0.9.0/LICENSE-APACHE`; `CARGO_CACHE/libappindicator-0.9.0/LICENSE-MIT` |
| libappindicator-sys | 0.9.0 | Apache-2.0 OR MIT | `CARGO_CACHE/libappindicator-sys-0.9.0/Cargo.toml`; no root notice found |
| libc | 0.2.189 | MIT OR Apache-2.0 | `CARGO_CACHE/libc-0.2.189/Cargo.toml`; `CARGO_CACHE/libc-0.2.189/LICENSE-APACHE`; `CARGO_CACHE/libc-0.2.189/LICENSE-MIT` |
| libdbus-sys | 0.2.7 | Apache-2.0/MIT | `CARGO_CACHE/libdbus-sys-0.2.7/Cargo.toml`; `CARGO_CACHE/libdbus-sys-0.2.7/LICENSE-APACHE`; `CARGO_CACHE/libdbus-sys-0.2.7/LICENSE-MIT` |
| libloading | 0.7.4 | ISC | `CARGO_CACHE/libloading-0.7.4/Cargo.toml`; `CARGO_CACHE/libloading-0.7.4/LICENSE` |
| libredox | 0.1.20 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| libsqlite3-sys | 0.28.0 | MIT | `CARGO_CACHE/libsqlite3-sys-0.28.0/Cargo.toml`; `CARGO_CACHE/libsqlite3-sys-0.28.0/LICENSE` |
| linux-raw-sys | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | `CARGO_CACHE/linux-raw-sys-0.12.1/Cargo.toml`; `CARGO_CACHE/linux-raw-sys-0.12.1/COPYRIGHT`; `CARGO_CACHE/linux-raw-sys-0.12.1/LICENSE-APACHE`; `CARGO_CACHE/linux-raw-sys-0.12.1/LICENSE-Apache-2.0_WITH_LLVM-exception`; `CARGO_CACHE/linux-raw-sys-0.12.1/LICENSE-MIT` |
| litemap | 0.8.3 | Unicode-3.0 | `CARGO_CACHE/litemap-0.8.3/Cargo.toml`; `CARGO_CACHE/litemap-0.8.3/LICENSE` |
| litrs | 1.0.0 | MIT OR Apache-2.0 | `CARGO_CACHE/litrs-1.0.0/Cargo.toml`; `CARGO_CACHE/litrs-1.0.0/LICENSE-APACHE`; `CARGO_CACHE/litrs-1.0.0/LICENSE-MIT` |
| lock_api | 0.4.14 | MIT OR Apache-2.0 | `CARGO_CACHE/lock_api-0.4.14/Cargo.toml`; `CARGO_CACHE/lock_api-0.4.14/LICENSE-APACHE`; `CARGO_CACHE/lock_api-0.4.14/LICENSE-MIT` |
| log | 0.4.33 | MIT OR Apache-2.0 | `CARGO_CACHE/log-0.4.33/Cargo.toml`; `CARGO_CACHE/log-0.4.33/LICENSE-APACHE`; `CARGO_CACHE/log-0.4.33/LICENSE-MIT` |
| mac-notification-sys | 0.6.15 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| markup5ever | 0.38.0 | MIT OR Apache-2.0 | `CARGO_CACHE/markup5ever-0.38.0/Cargo.toml`; `CARGO_CACHE/markup5ever-0.38.0/LICENSE-APACHE`; `CARGO_CACHE/markup5ever-0.38.0/LICENSE-MIT` |
| memchr | 2.8.3 | Unlicense OR MIT | `CARGO_CACHE/memchr-2.8.3/Cargo.toml`; `CARGO_CACHE/memchr-2.8.3/COPYING`; `CARGO_CACHE/memchr-2.8.3/LICENSE-MIT`; `CARGO_CACHE/memchr-2.8.3/UNLICENSE` |
| memoffset | 0.9.1 | MIT | `CARGO_CACHE/memoffset-0.9.1/Cargo.toml`; `CARGO_CACHE/memoffset-0.9.1/LICENSE` |
| mime | 0.3.17 | MIT OR Apache-2.0 | `CARGO_CACHE/mime-0.3.17/Cargo.toml`; `CARGO_CACHE/mime-0.3.17/LICENSE-APACHE`; `CARGO_CACHE/mime-0.3.17/LICENSE-MIT` |
| minisign-verify | 0.2.5 | MIT | `CARGO_CACHE/minisign-verify-0.2.5/Cargo.toml`; `CARGO_CACHE/minisign-verify-0.2.5/LICENSE` |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 | `CARGO_CACHE/miniz_oxide-0.8.9/Cargo.toml`; `CARGO_CACHE/miniz_oxide-0.8.9/LICENSE`; `CARGO_CACHE/miniz_oxide-0.8.9/LICENSE-APACHE.md`; `CARGO_CACHE/miniz_oxide-0.8.9/LICENSE-MIT.md`; `CARGO_CACHE/miniz_oxide-0.8.9/LICENSE-ZLIB.md` |
| mio | 1.2.2 | MIT | `CARGO_CACHE/mio-1.2.2/Cargo.toml`; `CARGO_CACHE/mio-1.2.2/LICENSE` |
| muda | 0.19.3 | Apache-2.0 OR MIT | `CARGO_CACHE/muda-0.19.3/Cargo.toml`; `CARGO_CACHE/muda-0.19.3/LICENSE-APACHE`; `CARGO_CACHE/muda-0.19.3/LICENSE-MIT`; `CARGO_CACHE/muda-0.19.3/LICENSE.spdx` |
| native-tls | 0.2.18 | MIT OR Apache-2.0 | `CARGO_CACHE/native-tls-0.2.18/Cargo.toml`; `CARGO_CACHE/native-tls-0.2.18/LICENSE-APACHE`; `CARGO_CACHE/native-tls-0.2.18/LICENSE-MIT` |
| ndk | 0.9.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| ndk-sys | 0.6.0+11769913 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| new_debug_unreachable | 1.0.6 | MIT | `CARGO_CACHE/new_debug_unreachable-1.0.6/Cargo.toml`; `CARGO_CACHE/new_debug_unreachable-1.0.6/LICENSE-MIT` |
| notify-rust | 4.18.0 | MIT OR Apache-2.0 | `CARGO_CACHE/notify-rust-4.18.0/Cargo.toml`; `CARGO_CACHE/notify-rust-4.18.0/LICENSE-Apache`; `CARGO_CACHE/notify-rust-4.18.0/LICENSE-MIT` |
| num-conv | 0.2.2 | MIT OR Apache-2.0 | `CARGO_CACHE/num-conv-0.2.2/Cargo.toml`; `CARGO_CACHE/num-conv-0.2.2/LICENSE-Apache`; `CARGO_CACHE/num-conv-0.2.2/LICENSE-MIT` |
| num-traits | 0.2.19 | MIT OR Apache-2.0 | `CARGO_CACHE/num-traits-0.2.19/Cargo.toml`; `CARGO_CACHE/num-traits-0.2.19/LICENSE-APACHE`; `CARGO_CACHE/num-traits-0.2.19/LICENSE-MIT` |
| num_enum | 0.7.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| num_enum_derive | 0.7.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2 | 0.6.4 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-app-kit | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-cloud-kit | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-core-data | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-core-foundation | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-core-graphics | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-core-image | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-core-location | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-core-text | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-encode | 4.1.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-exception-helper | 0.1.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-foundation | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-io-surface | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-osa-kit | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-quartz-core | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-ui-kit | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-user-notifications | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| objc2-web-kit | 0.3.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | `CARGO_CACHE/once_cell-1.21.4/Cargo.toml`; `CARGO_CACHE/once_cell-1.21.4/LICENSE-APACHE`; `CARGO_CACHE/once_cell-1.21.4/LICENSE-MIT` |
| open | 5.4.1 | MIT | `CARGO_CACHE/open-5.4.1/Cargo.toml`; `CARGO_CACHE/open-5.4.1/LICENSE.md` |
| openssl | 0.10.81 | Apache-2.0 | `CARGO_CACHE/openssl-0.10.81/Cargo.toml`; `CARGO_CACHE/openssl-0.10.81/LICENSE`; `CARGO_CACHE/openssl-0.10.81/LICENSE-APACHE` |
| openssl-macros | 0.1.1 | MIT/Apache-2.0 | `CARGO_CACHE/openssl-macros-0.1.1/Cargo.toml`; `CARGO_CACHE/openssl-macros-0.1.1/LICENSE-APACHE`; `CARGO_CACHE/openssl-macros-0.1.1/LICENSE-MIT` |
| openssl-probe | 0.2.1 | MIT OR Apache-2.0 | `CARGO_CACHE/openssl-probe-0.2.1/Cargo.toml`; `CARGO_CACHE/openssl-probe-0.2.1/LICENSE-APACHE`; `CARGO_CACHE/openssl-probe-0.2.1/LICENSE-MIT` |
| openssl-sys | 0.9.117 | MIT | `CARGO_CACHE/openssl-sys-0.9.117/Cargo.toml`; `CARGO_CACHE/openssl-sys-0.9.117/LICENSE-MIT` |
| option-ext | 0.2.0 | MPL-2.0 | `CARGO_CACHE/option-ext-0.2.0/Cargo.toml`; `CARGO_CACHE/option-ext-0.2.0/LICENSE.txt` |
| ordered-stream | 0.2.0 | MIT OR Apache-2.0 | `CARGO_CACHE/ordered-stream-0.2.0/Cargo.toml`; `CARGO_CACHE/ordered-stream-0.2.0/LICENSE-APACHE`; `CARGO_CACHE/ordered-stream-0.2.0/LICENSE-MIT` |
| osakit | 0.3.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| pango | 0.18.3 | MIT | `CARGO_CACHE/pango-0.18.3/Cargo.toml`; `CARGO_CACHE/pango-0.18.3/COPYRIGHT`; `CARGO_CACHE/pango-0.18.3/LICENSE` |
| pango-sys | 0.18.0 | MIT | `CARGO_CACHE/pango-sys-0.18.0/Cargo.toml`; `CARGO_CACHE/pango-sys-0.18.0/LICENSE` |
| parking | 2.2.1 | Apache-2.0 OR MIT | `CARGO_CACHE/parking-2.2.1/Cargo.toml`; `CARGO_CACHE/parking-2.2.1/LICENSE-APACHE`; `CARGO_CACHE/parking-2.2.1/LICENSE-MIT`; `CARGO_CACHE/parking-2.2.1/LICENSE-THIRD-PARTY` |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 | `CARGO_CACHE/parking_lot-0.12.5/Cargo.toml`; `CARGO_CACHE/parking_lot-0.12.5/LICENSE-APACHE`; `CARGO_CACHE/parking_lot-0.12.5/LICENSE-MIT` |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 | `CARGO_CACHE/parking_lot_core-0.9.12/Cargo.toml`; `CARGO_CACHE/parking_lot_core-0.9.12/LICENSE-APACHE`; `CARGO_CACHE/parking_lot_core-0.9.12/LICENSE-MIT` |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 | `CARGO_CACHE/percent-encoding-2.3.2/Cargo.toml`; `CARGO_CACHE/percent-encoding-2.3.2/LICENSE-APACHE`; `CARGO_CACHE/percent-encoding-2.3.2/LICENSE-MIT` |
| phf | 0.13.1 | MIT | `CARGO_CACHE/phf-0.13.1/Cargo.toml`; `CARGO_CACHE/phf-0.13.1/LICENSE` |
| phf_codegen | 0.13.1 | MIT | `CARGO_CACHE/phf_codegen-0.13.1/Cargo.toml`; `CARGO_CACHE/phf_codegen-0.13.1/LICENSE` |
| phf_generator | 0.13.1 | MIT | `CARGO_CACHE/phf_generator-0.13.1/Cargo.toml`; `CARGO_CACHE/phf_generator-0.13.1/LICENSE` |
| phf_macros | 0.13.1 | MIT | `CARGO_CACHE/phf_macros-0.13.1/Cargo.toml`; `CARGO_CACHE/phf_macros-0.13.1/LICENSE` |
| phf_shared | 0.13.1 | MIT | `CARGO_CACHE/phf_shared-0.13.1/Cargo.toml`; `CARGO_CACHE/phf_shared-0.13.1/LICENSE` |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT | `CARGO_CACHE/pin-project-lite-0.2.17/Cargo.toml`; `CARGO_CACHE/pin-project-lite-0.2.17/LICENSE-APACHE`; `CARGO_CACHE/pin-project-lite-0.2.17/LICENSE-MIT` |
| piper | 0.2.5 | MIT OR Apache-2.0 | `CARGO_CACHE/piper-0.2.5/Cargo.toml`; `CARGO_CACHE/piper-0.2.5/LICENSE-APACHE`; `CARGO_CACHE/piper-0.2.5/LICENSE-MIT` |
| pkg-config | 0.3.34 | MIT OR Apache-2.0 | `CARGO_CACHE/pkg-config-0.3.34/Cargo.toml`; `CARGO_CACHE/pkg-config-0.3.34/LICENSE-APACHE`; `CARGO_CACHE/pkg-config-0.3.34/LICENSE-MIT` |
| plist | 1.10.0 | MIT | `CARGO_CACHE/plist-1.10.0/Cargo.toml`; `CARGO_CACHE/plist-1.10.0/LICENCE` |
| png | 0.17.16 | MIT OR Apache-2.0 | `CARGO_CACHE/png-0.17.16/Cargo.toml`; `CARGO_CACHE/png-0.17.16/LICENSE-APACHE`; `CARGO_CACHE/png-0.17.16/LICENSE-MIT` |
| png | 0.18.1 | MIT OR Apache-2.0 | `CARGO_CACHE/png-0.18.1/Cargo.toml`; `CARGO_CACHE/png-0.18.1/LICENSE-APACHE`; `CARGO_CACHE/png-0.18.1/LICENSE-MIT` |
| polling | 3.11.0 | Apache-2.0 OR MIT | `CARGO_CACHE/polling-3.11.0/Cargo.toml`; `CARGO_CACHE/polling-3.11.0/LICENSE-APACHE`; `CARGO_CACHE/polling-3.11.0/LICENSE-MIT` |
| portable-atomic | 1.15.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| portable-atomic-util | 0.2.7 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| potential_utf | 0.1.6 | Unicode-3.0 | `CARGO_CACHE/potential_utf-0.1.6/Cargo.toml`; `CARGO_CACHE/potential_utf-0.1.6/LICENSE` |
| powerfmt | 0.2.0 | MIT OR Apache-2.0 | `CARGO_CACHE/powerfmt-0.2.0/Cargo.toml`; `CARGO_CACHE/powerfmt-0.2.0/LICENSE-Apache`; `CARGO_CACHE/powerfmt-0.2.0/LICENSE-MIT` |
| ppv-lite86 | 0.2.21 | MIT OR Apache-2.0 | `CARGO_CACHE/ppv-lite86-0.2.21/Cargo.toml`; `CARGO_CACHE/ppv-lite86-0.2.21/LICENSE-APACHE`; `CARGO_CACHE/ppv-lite86-0.2.21/LICENSE-MIT` |
| precomputed-hash | 0.1.1 | MIT | `CARGO_CACHE/precomputed-hash-0.1.1/Cargo.toml`; `CARGO_CACHE/precomputed-hash-0.1.1/LICENSE` |
| proc-macro-crate | 1.3.1 | MIT OR Apache-2.0 | `CARGO_CACHE/proc-macro-crate-1.3.1/Cargo.toml`; `CARGO_CACHE/proc-macro-crate-1.3.1/LICENSE-APACHE`; `CARGO_CACHE/proc-macro-crate-1.3.1/LICENSE-MIT` |
| proc-macro-crate | 2.0.2 | MIT OR Apache-2.0 | `CARGO_CACHE/proc-macro-crate-2.0.2/Cargo.toml`; `CARGO_CACHE/proc-macro-crate-2.0.2/LICENSE-APACHE`; `CARGO_CACHE/proc-macro-crate-2.0.2/LICENSE-MIT` |
| proc-macro-crate | 3.5.0 | MIT OR Apache-2.0 | `CARGO_CACHE/proc-macro-crate-3.5.0/Cargo.toml`; `CARGO_CACHE/proc-macro-crate-3.5.0/LICENSE-APACHE`; `CARGO_CACHE/proc-macro-crate-3.5.0/LICENSE-MIT` |
| proc-macro-error | 1.0.4 | MIT OR Apache-2.0 | `CARGO_CACHE/proc-macro-error-1.0.4/Cargo.toml`; `CARGO_CACHE/proc-macro-error-1.0.4/LICENSE-APACHE`; `CARGO_CACHE/proc-macro-error-1.0.4/LICENSE-MIT` |
| proc-macro-error-attr | 1.0.4 | MIT OR Apache-2.0 | `CARGO_CACHE/proc-macro-error-attr-1.0.4/Cargo.toml`; `CARGO_CACHE/proc-macro-error-attr-1.0.4/LICENSE-APACHE`; `CARGO_CACHE/proc-macro-error-attr-1.0.4/LICENSE-MIT` |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 | `CARGO_CACHE/proc-macro2-1.0.107/Cargo.toml`; `CARGO_CACHE/proc-macro2-1.0.107/LICENSE-APACHE`; `CARGO_CACHE/proc-macro2-1.0.107/LICENSE-MIT` |
| psl-types | 2.0.11 | MIT/Apache-2.0 | `CARGO_CACHE/psl-types-2.0.11/Cargo.toml`; `CARGO_CACHE/psl-types-2.0.11/LICENSE`; `CARGO_CACHE/psl-types-2.0.11/LICENSE-APACHE` |
| publicsuffix | 2.3.0 | MIT/Apache-2.0 | `CARGO_CACHE/publicsuffix-2.3.0/Cargo.toml`; `CARGO_CACHE/publicsuffix-2.3.0/LICENSE`; `CARGO_CACHE/publicsuffix-2.3.0/LICENSE-APACHE` |
| quick-xml | 0.41.0 | MIT | `CARGO_CACHE/quick-xml-0.41.0/Cargo.toml`; `CARGO_CACHE/quick-xml-0.41.0/LICENSE-MIT.md` |
| quote | 1.0.47 | MIT OR Apache-2.0 | `CARGO_CACHE/quote-1.0.47/Cargo.toml`; `CARGO_CACHE/quote-1.0.47/LICENSE-APACHE`; `CARGO_CACHE/quote-1.0.47/LICENSE-MIT` |
| r-efi | 5.3.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| r-efi | 6.0.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| rand | 0.9.2 | MIT OR Apache-2.0 | `CARGO_CACHE/rand-0.9.2/Cargo.toml`; `CARGO_CACHE/rand-0.9.2/COPYRIGHT`; `CARGO_CACHE/rand-0.9.2/LICENSE-APACHE`; `CARGO_CACHE/rand-0.9.2/LICENSE-MIT` |
| rand_chacha | 0.9.0 | MIT OR Apache-2.0 | `CARGO_CACHE/rand_chacha-0.9.0/Cargo.toml`; `CARGO_CACHE/rand_chacha-0.9.0/COPYRIGHT`; `CARGO_CACHE/rand_chacha-0.9.0/LICENSE-APACHE`; `CARGO_CACHE/rand_chacha-0.9.0/LICENSE-MIT` |
| rand_core | 0.9.5 | MIT OR Apache-2.0 | `CARGO_CACHE/rand_core-0.9.5/Cargo.toml`; `CARGO_CACHE/rand_core-0.9.5/COPYRIGHT`; `CARGO_CACHE/rand_core-0.9.5/LICENSE-APACHE`; `CARGO_CACHE/rand_core-0.9.5/LICENSE-MIT` |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib | `CARGO_CACHE/raw-window-handle-0.6.2/Cargo.toml`; `CARGO_CACHE/raw-window-handle-0.6.2/LICENSE-APACHE.md`; `CARGO_CACHE/raw-window-handle-0.6.2/LICENSE-MIT.md`; `CARGO_CACHE/raw-window-handle-0.6.2/LICENSE-ZLIB.md` |
| redox_syscall | 0.5.18 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| redox_users | 0.5.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| ref-cast | 1.0.26 | MIT OR Apache-2.0 | `CARGO_CACHE/ref-cast-1.0.26/Cargo.toml`; `CARGO_CACHE/ref-cast-1.0.26/LICENSE-APACHE`; `CARGO_CACHE/ref-cast-1.0.26/LICENSE-MIT` |
| ref-cast-impl | 1.0.26 | MIT OR Apache-2.0 | `CARGO_CACHE/ref-cast-impl-1.0.26/Cargo.toml`; `CARGO_CACHE/ref-cast-impl-1.0.26/LICENSE-APACHE`; `CARGO_CACHE/ref-cast-impl-1.0.26/LICENSE-MIT` |
| regex | 1.13.1 | MIT OR Apache-2.0 | `CARGO_CACHE/regex-1.13.1/Cargo.toml`; `CARGO_CACHE/regex-1.13.1/LICENSE-APACHE`; `CARGO_CACHE/regex-1.13.1/LICENSE-MIT` |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 | `CARGO_CACHE/regex-automata-0.4.18/Cargo.toml`; `CARGO_CACHE/regex-automata-0.4.18/LICENSE-APACHE`; `CARGO_CACHE/regex-automata-0.4.18/LICENSE-MIT` |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 | `CARGO_CACHE/regex-syntax-0.8.11/Cargo.toml`; `CARGO_CACHE/regex-syntax-0.8.11/LICENSE-APACHE`; `CARGO_CACHE/regex-syntax-0.8.11/LICENSE-MIT` |
| reqwest | 0.12.28 | MIT OR Apache-2.0 | `CARGO_CACHE/reqwest-0.12.28/Cargo.toml`; `CARGO_CACHE/reqwest-0.12.28/LICENSE-APACHE`; `CARGO_CACHE/reqwest-0.12.28/LICENSE-MIT` |
| reqwest | 0.13.4 | MIT OR Apache-2.0 | `CARGO_CACHE/reqwest-0.13.4/Cargo.toml`; `CARGO_CACHE/reqwest-0.13.4/LICENSE-APACHE`; `CARGO_CACHE/reqwest-0.13.4/LICENSE-MIT` |
| rfd | 0.16.0 | MIT | `CARGO_CACHE/rfd-0.16.0/Cargo.toml`; `CARGO_CACHE/rfd-0.16.0/LICENSE` |
| ring | 0.17.14 | Apache-2.0 AND ISC | `CARGO_CACHE/ring-0.17.14/Cargo.toml`; `CARGO_CACHE/ring-0.17.14/LICENSE`; `CARGO_CACHE/ring-0.17.14/LICENSE-BoringSSL`; `CARGO_CACHE/ring-0.17.14/LICENSE-other-bits` |
| rusqlite | 0.31.0 | MIT | `CARGO_CACHE/rusqlite-0.31.0/Cargo.toml`; `CARGO_CACHE/rusqlite-0.31.0/LICENSE` |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT | `CARGO_CACHE/rustc-hash-2.1.3/Cargo.toml`; `CARGO_CACHE/rustc-hash-2.1.3/LICENSE-APACHE`; `CARGO_CACHE/rustc-hash-2.1.3/LICENSE-MIT` |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 | `CARGO_CACHE/rustc_version-0.4.1/Cargo.toml`; `CARGO_CACHE/rustc_version-0.4.1/LICENSE-APACHE`; `CARGO_CACHE/rustc_version-0.4.1/LICENSE-MIT` |
| rustix | 1.1.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | `CARGO_CACHE/rustix-1.1.4/Cargo.toml`; `CARGO_CACHE/rustix-1.1.4/COPYRIGHT`; `CARGO_CACHE/rustix-1.1.4/LICENSE-APACHE`; `CARGO_CACHE/rustix-1.1.4/LICENSE-Apache-2.0_WITH_LLVM-exception`; `CARGO_CACHE/rustix-1.1.4/LICENSE-MIT` |
| rustls | 0.23.43 | Apache-2.0 OR ISC OR MIT | `CARGO_CACHE/rustls-0.23.43/Cargo.toml`; `CARGO_CACHE/rustls-0.23.43/LICENSE-APACHE`; `CARGO_CACHE/rustls-0.23.43/LICENSE-ISC`; `CARGO_CACHE/rustls-0.23.43/LICENSE-MIT` |
| rustls-native-certs | 0.8.4 | Apache-2.0 OR ISC OR MIT | `CARGO_CACHE/rustls-native-certs-0.8.4/Cargo.toml`; `CARGO_CACHE/rustls-native-certs-0.8.4/LICENSE`; `CARGO_CACHE/rustls-native-certs-0.8.4/LICENSE-APACHE`; `CARGO_CACHE/rustls-native-certs-0.8.4/LICENSE-ISC`; `CARGO_CACHE/rustls-native-certs-0.8.4/LICENSE-MIT` |
| rustls-pki-types | 1.15.1 | MIT OR Apache-2.0 | `CARGO_CACHE/rustls-pki-types-1.15.1/Cargo.toml`; `CARGO_CACHE/rustls-pki-types-1.15.1/LICENSE-APACHE`; `CARGO_CACHE/rustls-pki-types-1.15.1/LICENSE-MIT` |
| rustls-platform-verifier | 0.7.0 | MIT OR Apache-2.0 | `CARGO_CACHE/rustls-platform-verifier-0.7.0/Cargo.toml`; `CARGO_CACHE/rustls-platform-verifier-0.7.0/LICENSE-APACHE`; `CARGO_CACHE/rustls-platform-verifier-0.7.0/LICENSE-MIT` |
| rustls-platform-verifier-android | 0.1.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| rustls-webpki | 0.103.14 | ISC | `CARGO_CACHE/rustls-webpki-0.103.14/Cargo.toml`; `CARGO_CACHE/rustls-webpki-0.103.14/LICENSE` |
| rustversion | 1.0.23 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| ryu | 1.0.23 | Apache-2.0 OR BSL-1.0 | `CARGO_CACHE/ryu-1.0.23/Cargo.toml`; `CARGO_CACHE/ryu-1.0.23/LICENSE-APACHE`; `CARGO_CACHE/ryu-1.0.23/LICENSE-BOOST` |
| same-file | 1.0.6 | Unlicense/MIT | `CARGO_CACHE/same-file-1.0.6/Cargo.toml`; `CARGO_CACHE/same-file-1.0.6/COPYING`; `CARGO_CACHE/same-file-1.0.6/LICENSE-MIT`; `CARGO_CACHE/same-file-1.0.6/UNLICENSE` |
| schannel | 0.1.29 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| schemars | 0.8.22 | MIT | `CARGO_CACHE/schemars-0.8.22/Cargo.toml`; `CARGO_CACHE/schemars-0.8.22/LICENSE` |
| schemars | 0.9.0 | MIT | `CARGO_CACHE/schemars-0.9.0/Cargo.toml`; `CARGO_CACHE/schemars-0.9.0/LICENSE` |
| schemars | 1.2.2 | MIT | `CARGO_CACHE/schemars-1.2.2/Cargo.toml`; `CARGO_CACHE/schemars-1.2.2/LICENSE` |
| schemars_derive | 0.8.22 | MIT | `CARGO_CACHE/schemars_derive-0.8.22/Cargo.toml`; `CARGO_CACHE/schemars_derive-0.8.22/LICENSE` |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 | `CARGO_CACHE/scopeguard-1.2.0/Cargo.toml`; `CARGO_CACHE/scopeguard-1.2.0/LICENSE-APACHE`; `CARGO_CACHE/scopeguard-1.2.0/LICENSE-MIT` |
| security-framework | 2.11.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| security-framework | 3.7.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| security-framework-sys | 2.17.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| selectors | 0.36.1 | MPL-2.0 | `CARGO_CACHE/selectors-0.36.1/Cargo.toml`; no root notice found |
| semver | 1.0.28 | MIT OR Apache-2.0 | `CARGO_CACHE/semver-1.0.28/Cargo.toml`; `CARGO_CACHE/semver-1.0.28/LICENSE-APACHE`; `CARGO_CACHE/semver-1.0.28/LICENSE-MIT` |
| serde | 1.0.229 | MIT OR Apache-2.0 | `CARGO_CACHE/serde-1.0.229/Cargo.toml`; `CARGO_CACHE/serde-1.0.229/LICENSE-APACHE`; `CARGO_CACHE/serde-1.0.229/LICENSE-MIT` |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 | `CARGO_CACHE/serde-untagged-0.1.9/Cargo.toml`; `CARGO_CACHE/serde-untagged-0.1.9/LICENSE-APACHE`; `CARGO_CACHE/serde-untagged-0.1.9/LICENSE-MIT` |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_core-1.0.229/Cargo.toml`; `CARGO_CACHE/serde_core-1.0.229/LICENSE-APACHE`; `CARGO_CACHE/serde_core-1.0.229/LICENSE-MIT` |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_derive-1.0.229/Cargo.toml`; `CARGO_CACHE/serde_derive-1.0.229/LICENSE-APACHE`; `CARGO_CACHE/serde_derive-1.0.229/LICENSE-MIT` |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_derive_internals-0.29.1/Cargo.toml`; `CARGO_CACHE/serde_derive_internals-0.29.1/LICENSE-APACHE`; `CARGO_CACHE/serde_derive_internals-0.29.1/LICENSE-MIT` |
| serde_json | 1.0.151 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_json-1.0.151/Cargo.toml`; `CARGO_CACHE/serde_json-1.0.151/LICENSE-APACHE`; `CARGO_CACHE/serde_json-1.0.151/LICENSE-MIT` |
| serde_repr | 0.1.21 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_repr-0.1.21/Cargo.toml`; `CARGO_CACHE/serde_repr-0.1.21/LICENSE-APACHE`; `CARGO_CACHE/serde_repr-0.1.21/LICENSE-MIT` |
| serde_spanned | 0.6.9 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_spanned-0.6.9/Cargo.toml`; `CARGO_CACHE/serde_spanned-0.6.9/LICENSE-APACHE`; `CARGO_CACHE/serde_spanned-0.6.9/LICENSE-MIT` |
| serde_spanned | 1.1.1 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_spanned-1.1.1/Cargo.toml`; `CARGO_CACHE/serde_spanned-1.1.1/LICENSE-APACHE`; `CARGO_CACHE/serde_spanned-1.1.1/LICENSE-MIT` |
| serde_urlencoded | 0.7.1 | MIT/Apache-2.0 | `CARGO_CACHE/serde_urlencoded-0.7.1/Cargo.toml`; `CARGO_CACHE/serde_urlencoded-0.7.1/LICENSE-APACHE`; `CARGO_CACHE/serde_urlencoded-0.7.1/LICENSE-MIT` |
| serde_with | 3.22.0 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_with-3.22.0/Cargo.toml`; `CARGO_CACHE/serde_with-3.22.0/LICENSE-APACHE`; `CARGO_CACHE/serde_with-3.22.0/LICENSE-MIT` |
| serde_with_macros | 3.22.0 | MIT OR Apache-2.0 | `CARGO_CACHE/serde_with_macros-3.22.0/Cargo.toml`; `CARGO_CACHE/serde_with_macros-3.22.0/LICENSE-APACHE`; `CARGO_CACHE/serde_with_macros-3.22.0/LICENSE-MIT` |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 | `CARGO_CACHE/serialize-to-javascript-0.1.2/Cargo.toml`; `CARGO_CACHE/serialize-to-javascript-0.1.2/LICENSE-APACHE`; `CARGO_CACHE/serialize-to-javascript-0.1.2/LICENSE-MIT` |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 | `CARGO_CACHE/serialize-to-javascript-impl-0.1.2/Cargo.toml`; `CARGO_CACHE/serialize-to-javascript-impl-0.1.2/LICENSE-APACHE`; `CARGO_CACHE/serialize-to-javascript-impl-0.1.2/LICENSE-MIT` |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 | `CARGO_CACHE/servo_arc-0.4.3/Cargo.toml`; `CARGO_CACHE/servo_arc-0.4.3/LICENSE-APACHE`; `CARGO_CACHE/servo_arc-0.4.3/LICENSE-MIT` |
| sha2 | 0.10.9 | MIT OR Apache-2.0 | `CARGO_CACHE/sha2-0.10.9/Cargo.toml`; `CARGO_CACHE/sha2-0.10.9/LICENSE-APACHE`; `CARGO_CACHE/sha2-0.10.9/LICENSE-MIT` |
| shlex | 2.0.1 | MIT OR Apache-2.0 | `CARGO_CACHE/shlex-2.0.1/Cargo.toml`; `CARGO_CACHE/shlex-2.0.1/LICENSE-APACHE`; `CARGO_CACHE/shlex-2.0.1/LICENSE-MIT` |
| signal-hook-registry | 1.4.8 | MIT OR Apache-2.0 | `CARGO_CACHE/signal-hook-registry-1.4.8/Cargo.toml`; `CARGO_CACHE/signal-hook-registry-1.4.8/LICENSE-APACHE`; `CARGO_CACHE/signal-hook-registry-1.4.8/LICENSE-MIT` |
| simd-adler32 | 0.3.10 | MIT | `CARGO_CACHE/simd-adler32-0.3.10/Cargo.toml`; `CARGO_CACHE/simd-adler32-0.3.10/LICENSE.md` |
| simd_cesu8 | 1.2.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| simdutf8 | 0.1.5 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| siphasher | 1.0.3 | MIT/Apache-2.0 | `CARGO_CACHE/siphasher-1.0.3/Cargo.toml`; `CARGO_CACHE/siphasher-1.0.3/COPYING` |
| slab | 0.4.12 | MIT | `CARGO_CACHE/slab-0.4.12/Cargo.toml`; `CARGO_CACHE/slab-0.4.12/LICENSE` |
| smallvec | 1.15.2 | MIT OR Apache-2.0 | `CARGO_CACHE/smallvec-1.15.2/Cargo.toml`; `CARGO_CACHE/smallvec-1.15.2/LICENSE-APACHE`; `CARGO_CACHE/smallvec-1.15.2/LICENSE-MIT` |
| socket2 | 0.6.5 | MIT OR Apache-2.0 | `CARGO_CACHE/socket2-0.6.5/Cargo.toml`; `CARGO_CACHE/socket2-0.6.5/LICENSE-APACHE`; `CARGO_CACHE/socket2-0.6.5/LICENSE-MIT` |
| softbuffer | 0.4.8 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| soup3 | 0.5.0 | MIT | `CARGO_CACHE/soup3-0.5.0/Cargo.toml`; `CARGO_CACHE/soup3-0.5.0/LICENSE` |
| soup3-sys | 0.5.0 | MIT | `CARGO_CACHE/soup3-sys-0.5.0/Cargo.toml`; `CARGO_CACHE/soup3-sys-0.5.0/LICENSE` |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 | `CARGO_CACHE/stable_deref_trait-1.2.1/Cargo.toml`; `CARGO_CACHE/stable_deref_trait-1.2.1/LICENSE-APACHE`; `CARGO_CACHE/stable_deref_trait-1.2.1/LICENSE-MIT` |
| string_cache | 0.9.0 | MIT OR Apache-2.0 | `CARGO_CACHE/string_cache-0.9.0/Cargo.toml`; `CARGO_CACHE/string_cache-0.9.0/LICENSE-APACHE`; `CARGO_CACHE/string_cache-0.9.0/LICENSE-MIT` |
| string_cache_codegen | 0.6.1 | MIT OR Apache-2.0 | `CARGO_CACHE/string_cache_codegen-0.6.1/Cargo.toml`; `CARGO_CACHE/string_cache_codegen-0.6.1/LICENSE-APACHE`; `CARGO_CACHE/string_cache_codegen-0.6.1/LICENSE-MIT` |
| strsim | 0.11.1 | MIT | `CARGO_CACHE/strsim-0.11.1/Cargo.toml`; `CARGO_CACHE/strsim-0.11.1/LICENSE` |
| subtle | 2.6.1 | BSD-3-Clause | `CARGO_CACHE/subtle-2.6.1/Cargo.toml`; `CARGO_CACHE/subtle-2.6.1/LICENSE` |
| swift-rs | 1.0.7 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| syn | 1.0.109 | MIT OR Apache-2.0 | `CARGO_CACHE/syn-1.0.109/Cargo.toml`; `CARGO_CACHE/syn-1.0.109/LICENSE-APACHE`; `CARGO_CACHE/syn-1.0.109/LICENSE-MIT` |
| syn | 2.0.119 | MIT OR Apache-2.0 | `CARGO_CACHE/syn-2.0.119/Cargo.toml`; `CARGO_CACHE/syn-2.0.119/LICENSE-APACHE`; `CARGO_CACHE/syn-2.0.119/LICENSE-MIT` |
| syn | 3.0.3 | MIT OR Apache-2.0 | `CARGO_CACHE/syn-3.0.3/Cargo.toml`; `CARGO_CACHE/syn-3.0.3/LICENSE-APACHE`; `CARGO_CACHE/syn-3.0.3/LICENSE-MIT` |
| sync_wrapper | 1.0.2 | Apache-2.0 | `CARGO_CACHE/sync_wrapper-1.0.2/Cargo.toml`; `CARGO_CACHE/sync_wrapper-1.0.2/LICENSE` |
| synstructure | 0.13.2 | MIT | `CARGO_CACHE/synstructure-0.13.2/Cargo.toml`; `CARGO_CACHE/synstructure-0.13.2/LICENSE` |
| system-configuration | 0.7.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| system-configuration-sys | 0.6.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| system-deps | 6.2.2 | MIT OR Apache-2.0 | `CARGO_CACHE/system-deps-6.2.2/Cargo.toml`; `CARGO_CACHE/system-deps-6.2.2/LICENSE-APACHE`; `CARGO_CACHE/system-deps-6.2.2/LICENSE-MIT` |
| tao | 0.35.3 | Apache-2.0 | `CARGO_CACHE/tao-0.35.3/Cargo.toml`; `CARGO_CACHE/tao-0.35.3/LICENSE`; `CARGO_CACHE/tao-0.35.3/LICENSE.spdx` |
| tao-macros | 0.1.4 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| tar | 0.4.46 | MIT OR Apache-2.0 | `CARGO_CACHE/tar-0.4.46/Cargo.toml`; `CARGO_CACHE/tar-0.4.46/LICENSE-APACHE`; `CARGO_CACHE/tar-0.4.46/LICENSE-MIT` |
| target-lexicon | 0.12.16 | Apache-2.0 WITH LLVM-exception | `CARGO_CACHE/target-lexicon-0.12.16/Cargo.toml`; `CARGO_CACHE/target-lexicon-0.12.16/LICENSE` |
| tauri | 2.11.5 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-2.11.5/Cargo.toml`; `CARGO_CACHE/tauri-2.11.5/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-2.11.5/LICENSE_MIT` |
| tauri-build | 2.6.3 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-build-2.6.3/Cargo.toml`; `CARGO_CACHE/tauri-build-2.6.3/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-build-2.6.3/LICENSE_MIT` |
| tauri-codegen | 2.6.3 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-codegen-2.6.3/Cargo.toml`; `CARGO_CACHE/tauri-codegen-2.6.3/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-codegen-2.6.3/LICENSE_MIT` |
| tauri-macros | 2.6.3 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-macros-2.6.3/Cargo.toml`; `CARGO_CACHE/tauri-macros-2.6.3/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-macros-2.6.3/LICENSE_MIT` |
| tauri-plugin | 2.6.3 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-plugin-2.6.3/Cargo.toml`; no root notice found |
| tauri-plugin-dialog | 2.7.2 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-plugin-dialog-2.7.2/Cargo.toml`; `CARGO_CACHE/tauri-plugin-dialog-2.7.2/LICENSE.spdx`; `CARGO_CACHE/tauri-plugin-dialog-2.7.2/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-plugin-dialog-2.7.2/LICENSE_MIT` |
| tauri-plugin-fs | 2.5.1 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-plugin-fs-2.5.1/Cargo.toml`; `CARGO_CACHE/tauri-plugin-fs-2.5.1/LICENSE.spdx`; `CARGO_CACHE/tauri-plugin-fs-2.5.1/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-plugin-fs-2.5.1/LICENSE_MIT` |
| tauri-plugin-notification | 2.3.3 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-plugin-notification-2.3.3/Cargo.toml`; `CARGO_CACHE/tauri-plugin-notification-2.3.3/LICENSE.spdx`; `CARGO_CACHE/tauri-plugin-notification-2.3.3/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-plugin-notification-2.3.3/LICENSE_MIT` |
| tauri-plugin-opener | 2.5.4 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-plugin-opener-2.5.4/Cargo.toml`; `CARGO_CACHE/tauri-plugin-opener-2.5.4/LICENSE.spdx`; `CARGO_CACHE/tauri-plugin-opener-2.5.4/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-plugin-opener-2.5.4/LICENSE_MIT` |
| tauri-plugin-process | 2.3.1 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-plugin-process-2.3.1/Cargo.toml`; `CARGO_CACHE/tauri-plugin-process-2.3.1/LICENSE.spdx`; `CARGO_CACHE/tauri-plugin-process-2.3.1/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-plugin-process-2.3.1/LICENSE_MIT` |
| tauri-plugin-updater | 2.10.1 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-plugin-updater-2.10.1/Cargo.toml`; `CARGO_CACHE/tauri-plugin-updater-2.10.1/LICENSE.spdx`; `CARGO_CACHE/tauri-plugin-updater-2.10.1/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-plugin-updater-2.10.1/LICENSE_MIT` |
| tauri-runtime | 2.11.3 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-runtime-2.11.3/Cargo.toml`; `CARGO_CACHE/tauri-runtime-2.11.3/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-runtime-2.11.3/LICENSE_MIT` |
| tauri-runtime-wry | 2.11.4 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-runtime-wry-2.11.4/Cargo.toml`; `CARGO_CACHE/tauri-runtime-wry-2.11.4/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-runtime-wry-2.11.4/LICENSE_MIT` |
| tauri-utils | 2.9.3 | Apache-2.0 OR MIT | `CARGO_CACHE/tauri-utils-2.9.3/Cargo.toml`; `CARGO_CACHE/tauri-utils-2.9.3/LICENSE_APACHE-2.0`; `CARGO_CACHE/tauri-utils-2.9.3/LICENSE_MIT` |
| tauri-winres | 0.3.6 | MIT | `CARGO_CACHE/tauri-winres-0.3.6/Cargo.toml`; `CARGO_CACHE/tauri-winres-0.3.6/LICENSE` |
| tauri-winrt-notification | 0.7.3 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| tempfile | 3.27.0 | MIT OR Apache-2.0 | `CARGO_CACHE/tempfile-3.27.0/Cargo.toml`; `CARGO_CACHE/tempfile-3.27.0/LICENSE-APACHE`; `CARGO_CACHE/tempfile-3.27.0/LICENSE-MIT` |
| tendril | 0.5.1 | MIT OR Apache-2.0 | `CARGO_CACHE/tendril-0.5.1/Cargo.toml`; `CARGO_CACHE/tendril-0.5.1/LICENSE-APACHE`; `CARGO_CACHE/tendril-0.5.1/LICENSE-MIT` |
| thiserror | 1.0.69 | MIT OR Apache-2.0 | `CARGO_CACHE/thiserror-1.0.69/Cargo.toml`; `CARGO_CACHE/thiserror-1.0.69/LICENSE-APACHE`; `CARGO_CACHE/thiserror-1.0.69/LICENSE-MIT` |
| thiserror | 2.0.20 | MIT OR Apache-2.0 | `CARGO_CACHE/thiserror-2.0.20/Cargo.toml`; `CARGO_CACHE/thiserror-2.0.20/LICENSE-APACHE`; `CARGO_CACHE/thiserror-2.0.20/LICENSE-MIT` |
| thiserror-impl | 1.0.69 | MIT OR Apache-2.0 | `CARGO_CACHE/thiserror-impl-1.0.69/Cargo.toml`; `CARGO_CACHE/thiserror-impl-1.0.69/LICENSE-APACHE`; `CARGO_CACHE/thiserror-impl-1.0.69/LICENSE-MIT` |
| thiserror-impl | 2.0.20 | MIT OR Apache-2.0 | `CARGO_CACHE/thiserror-impl-2.0.20/Cargo.toml`; `CARGO_CACHE/thiserror-impl-2.0.20/LICENSE-APACHE`; `CARGO_CACHE/thiserror-impl-2.0.20/LICENSE-MIT` |
| time | 0.3.55 | MIT OR Apache-2.0 | `CARGO_CACHE/time-0.3.55/Cargo.toml`; `CARGO_CACHE/time-0.3.55/LICENSE-Apache`; `CARGO_CACHE/time-0.3.55/LICENSE-MIT` |
| time-core | 0.1.9 | MIT OR Apache-2.0 | `CARGO_CACHE/time-core-0.1.9/Cargo.toml`; `CARGO_CACHE/time-core-0.1.9/LICENSE-Apache`; `CARGO_CACHE/time-core-0.1.9/LICENSE-MIT` |
| time-macros | 0.2.32 | MIT OR Apache-2.0 | `CARGO_CACHE/time-macros-0.2.32/Cargo.toml`; `CARGO_CACHE/time-macros-0.2.32/LICENSE-Apache`; `CARGO_CACHE/time-macros-0.2.32/LICENSE-MIT` |
| tinystr | 0.8.4 | Unicode-3.0 | `CARGO_CACHE/tinystr-0.8.4/Cargo.toml`; `CARGO_CACHE/tinystr-0.8.4/LICENSE` |
| tinyvec | 1.12.0 | Zlib OR Apache-2.0 OR MIT | `CARGO_CACHE/tinyvec-1.12.0/Cargo.toml`; `CARGO_CACHE/tinyvec-1.12.0/LICENSE-APACHE.md`; `CARGO_CACHE/tinyvec-1.12.0/LICENSE-MIT.md`; `CARGO_CACHE/tinyvec-1.12.0/LICENSE-ZLIB.md` |
| tinyvec_macros | 0.1.1 | MIT OR Apache-2.0 OR Zlib | `CARGO_CACHE/tinyvec_macros-0.1.1/Cargo.toml`; `CARGO_CACHE/tinyvec_macros-0.1.1/LICENSE-APACHE.md`; `CARGO_CACHE/tinyvec_macros-0.1.1/LICENSE-MIT.md`; `CARGO_CACHE/tinyvec_macros-0.1.1/LICENSE-ZLIB.md` |
| tokio | 1.53.1 | MIT | `CARGO_CACHE/tokio-1.53.1/Cargo.toml`; `CARGO_CACHE/tokio-1.53.1/LICENSE` |
| tokio-native-tls | 0.3.1 | MIT | `CARGO_CACHE/tokio-native-tls-0.3.1/Cargo.toml`; `CARGO_CACHE/tokio-native-tls-0.3.1/LICENSE` |
| tokio-rustls | 0.26.4 | MIT OR Apache-2.0 | `CARGO_CACHE/tokio-rustls-0.26.4/Cargo.toml`; `CARGO_CACHE/tokio-rustls-0.26.4/LICENSE-APACHE`; `CARGO_CACHE/tokio-rustls-0.26.4/LICENSE-MIT` |
| tokio-util | 0.7.19 | MIT | `CARGO_CACHE/tokio-util-0.7.19/Cargo.toml`; `CARGO_CACHE/tokio-util-0.7.19/LICENSE` |
| toml | 0.8.2 | MIT OR Apache-2.0 | `CARGO_CACHE/toml-0.8.2/Cargo.toml`; `CARGO_CACHE/toml-0.8.2/LICENSE-APACHE`; `CARGO_CACHE/toml-0.8.2/LICENSE-MIT` |
| toml | 0.9.12+spec-1.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/toml-0.9.12+spec-1.1.0/Cargo.toml`; `CARGO_CACHE/toml-0.9.12+spec-1.1.0/LICENSE-APACHE`; `CARGO_CACHE/toml-0.9.12+spec-1.1.0/LICENSE-MIT` |
| toml | 1.1.4+spec-1.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/toml-1.1.4+spec-1.1.0/Cargo.toml`; `CARGO_CACHE/toml-1.1.4+spec-1.1.0/LICENSE-APACHE`; `CARGO_CACHE/toml-1.1.4+spec-1.1.0/LICENSE-MIT` |
| toml_datetime | 0.6.3 | MIT OR Apache-2.0 | `CARGO_CACHE/toml_datetime-0.6.3/Cargo.toml`; `CARGO_CACHE/toml_datetime-0.6.3/LICENSE-APACHE`; `CARGO_CACHE/toml_datetime-0.6.3/LICENSE-MIT` |
| toml_datetime | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/toml_datetime-0.7.5+spec-1.1.0/Cargo.toml`; `CARGO_CACHE/toml_datetime-0.7.5+spec-1.1.0/LICENSE-APACHE`; `CARGO_CACHE/toml_datetime-0.7.5+spec-1.1.0/LICENSE-MIT` |
| toml_datetime | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/toml_datetime-1.1.1+spec-1.1.0/Cargo.toml`; `CARGO_CACHE/toml_datetime-1.1.1+spec-1.1.0/LICENSE-APACHE`; `CARGO_CACHE/toml_datetime-1.1.1+spec-1.1.0/LICENSE-MIT` |
| toml_edit | 0.19.15 | MIT OR Apache-2.0 | `CARGO_CACHE/toml_edit-0.19.15/Cargo.toml`; `CARGO_CACHE/toml_edit-0.19.15/LICENSE-APACHE`; `CARGO_CACHE/toml_edit-0.19.15/LICENSE-MIT` |
| toml_edit | 0.20.2 | MIT OR Apache-2.0 | `CARGO_CACHE/toml_edit-0.20.2/Cargo.toml`; `CARGO_CACHE/toml_edit-0.20.2/LICENSE-APACHE`; `CARGO_CACHE/toml_edit-0.20.2/LICENSE-MIT` |
| toml_edit | 0.25.13+spec-1.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/toml_edit-0.25.13+spec-1.1.0/Cargo.toml`; `CARGO_CACHE/toml_edit-0.25.13+spec-1.1.0/LICENSE-APACHE`; `CARGO_CACHE/toml_edit-0.25.13+spec-1.1.0/LICENSE-MIT` |
| toml_parser | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/toml_parser-1.1.3+spec-1.1.0/Cargo.toml`; `CARGO_CACHE/toml_parser-1.1.3+spec-1.1.0/LICENSE-APACHE`; `CARGO_CACHE/toml_parser-1.1.3+spec-1.1.0/LICENSE-MIT` |
| toml_writer | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | `CARGO_CACHE/toml_writer-1.1.2+spec-1.1.0/Cargo.toml`; `CARGO_CACHE/toml_writer-1.1.2+spec-1.1.0/LICENSE-APACHE`; `CARGO_CACHE/toml_writer-1.1.2+spec-1.1.0/LICENSE-MIT` |
| tower | 0.5.3 | MIT | `CARGO_CACHE/tower-0.5.3/Cargo.toml`; `CARGO_CACHE/tower-0.5.3/LICENSE` |
| tower-http | 0.6.11 | MIT | `CARGO_CACHE/tower-http-0.6.11/Cargo.toml`; `CARGO_CACHE/tower-http-0.6.11/LICENSE` |
| tower-layer | 0.3.3 | MIT | `CARGO_CACHE/tower-layer-0.3.3/Cargo.toml`; `CARGO_CACHE/tower-layer-0.3.3/LICENSE` |
| tower-service | 0.3.3 | MIT | `CARGO_CACHE/tower-service-0.3.3/Cargo.toml`; `CARGO_CACHE/tower-service-0.3.3/LICENSE` |
| tracing | 0.1.44 | MIT | `CARGO_CACHE/tracing-0.1.44/Cargo.toml`; `CARGO_CACHE/tracing-0.1.44/LICENSE` |
| tracing-attributes | 0.1.31 | MIT | `CARGO_CACHE/tracing-attributes-0.1.31/Cargo.toml`; `CARGO_CACHE/tracing-attributes-0.1.31/LICENSE` |
| tracing-core | 0.1.36 | MIT | `CARGO_CACHE/tracing-core-0.1.36/Cargo.toml`; `CARGO_CACHE/tracing-core-0.1.36/LICENSE` |
| tray-icon | 0.24.2 | MIT OR Apache-2.0 | `CARGO_CACHE/tray-icon-0.24.2/Cargo.toml`; `CARGO_CACHE/tray-icon-0.24.2/LICENSE-APACHE`; `CARGO_CACHE/tray-icon-0.24.2/LICENSE-MIT`; `CARGO_CACHE/tray-icon-0.24.2/LICENSE.spdx` |
| try-lock | 0.2.5 | MIT | `CARGO_CACHE/try-lock-0.2.5/Cargo.toml`; `CARGO_CACHE/try-lock-0.2.5/LICENSE` |
| typeid | 1.0.3 | MIT OR Apache-2.0 | `CARGO_CACHE/typeid-1.0.3/Cargo.toml`; `CARGO_CACHE/typeid-1.0.3/LICENSE-APACHE`; `CARGO_CACHE/typeid-1.0.3/LICENSE-MIT` |
| typenum | 1.20.1 | MIT OR Apache-2.0 | `CARGO_CACHE/typenum-1.20.1/Cargo.toml`; `CARGO_CACHE/typenum-1.20.1/LICENSE`; `CARGO_CACHE/typenum-1.20.1/LICENSE-APACHE`; `CARGO_CACHE/typenum-1.20.1/LICENSE-MIT` |
| uds_windows | 1.2.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 | `CARGO_CACHE/unic-char-property-0.9.0/Cargo.toml`; no root notice found |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 | `CARGO_CACHE/unic-char-range-0.9.0/Cargo.toml`; no root notice found |
| unic-common | 0.9.0 | MIT/Apache-2.0 | `CARGO_CACHE/unic-common-0.9.0/Cargo.toml`; no root notice found |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 | `CARGO_CACHE/unic-ucd-ident-0.9.0/Cargo.toml`; no root notice found |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 | `CARGO_CACHE/unic-ucd-version-0.9.0/Cargo.toml`; no root notice found |
| unicode-ident | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 | `CARGO_CACHE/unicode-ident-1.0.24/Cargo.toml`; `CARGO_CACHE/unicode-ident-1.0.24/LICENSE-APACHE`; `CARGO_CACHE/unicode-ident-1.0.24/LICENSE-MIT`; `CARGO_CACHE/unicode-ident-1.0.24/LICENSE-UNICODE` |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 | `CARGO_CACHE/unicode-segmentation-1.13.3/Cargo.toml`; `CARGO_CACHE/unicode-segmentation-1.13.3/COPYRIGHT`; `CARGO_CACHE/unicode-segmentation-1.13.3/LICENSE-APACHE`; `CARGO_CACHE/unicode-segmentation-1.13.3/LICENSE-MIT` |
| untrusted | 0.9.0 | ISC | `CARGO_CACHE/untrusted-0.9.0/Cargo.toml`; `CARGO_CACHE/untrusted-0.9.0/LICENSE.txt` |
| url | 2.5.8 | MIT OR Apache-2.0 | `CARGO_CACHE/url-2.5.8/Cargo.toml`; `CARGO_CACHE/url-2.5.8/LICENSE-APACHE`; `CARGO_CACHE/url-2.5.8/LICENSE-MIT` |
| urlpattern | 0.3.0 | MIT | `CARGO_CACHE/urlpattern-0.3.0/Cargo.toml`; `CARGO_CACHE/urlpattern-0.3.0/LICENSE` |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT | `CARGO_CACHE/utf8_iter-1.0.4/Cargo.toml`; `CARGO_CACHE/utf8_iter-1.0.4/COPYRIGHT`; `CARGO_CACHE/utf8_iter-1.0.4/LICENSE-APACHE`; `CARGO_CACHE/utf8_iter-1.0.4/LICENSE-MIT` |
| uuid | 0.8.2 | Apache-2.0 OR MIT | `CARGO_CACHE/uuid-0.8.2/Cargo.toml`; `CARGO_CACHE/uuid-0.8.2/COPYRIGHT`; `CARGO_CACHE/uuid-0.8.2/LICENSE-APACHE`; `CARGO_CACHE/uuid-0.8.2/LICENSE-MIT` |
| uuid | 1.24.1 | Apache-2.0 OR MIT | `CARGO_CACHE/uuid-1.24.1/Cargo.toml`; `CARGO_CACHE/uuid-1.24.1/LICENSE-APACHE`; `CARGO_CACHE/uuid-1.24.1/LICENSE-MIT` |
| vcpkg | 0.2.15 | MIT/Apache-2.0 | `CARGO_CACHE/vcpkg-0.2.15/Cargo.toml`; `CARGO_CACHE/vcpkg-0.2.15/LICENSE-APACHE`; `CARGO_CACHE/vcpkg-0.2.15/LICENSE-MIT` |
| version-compare | 0.2.1 | MIT | `CARGO_CACHE/version-compare-0.2.1/Cargo.toml`; `CARGO_CACHE/version-compare-0.2.1/LICENSE` |
| version_check | 0.9.5 | MIT/Apache-2.0 | `CARGO_CACHE/version_check-0.9.5/Cargo.toml`; `CARGO_CACHE/version_check-0.9.5/LICENSE-APACHE`; `CARGO_CACHE/version_check-0.9.5/LICENSE-MIT` |
| vswhom | 0.1.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| vswhom-sys | 0.1.3 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| walkdir | 2.5.0 | Unlicense/MIT | `CARGO_CACHE/walkdir-2.5.0/Cargo.toml`; `CARGO_CACHE/walkdir-2.5.0/COPYING`; `CARGO_CACHE/walkdir-2.5.0/LICENSE-MIT`; `CARGO_CACHE/walkdir-2.5.0/UNLICENSE` |
| want | 0.3.1 | MIT | `CARGO_CACHE/want-0.3.1/Cargo.toml`; `CARGO_CACHE/want-0.3.1/LICENSE` |
| wasi | 0.11.1+wasi-snapshot-preview1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| wasip2 | 1.0.4+wasi-0.2.12 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| wasm-bindgen | 0.2.127 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| wasm-bindgen-futures | 0.4.77 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| wasm-bindgen-macro | 0.2.127 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| wasm-bindgen-macro-support | 0.2.127 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| wasm-bindgen-shared | 0.2.127 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| wasm-streams | 0.5.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| web-sys | 0.3.104 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| web_atoms | 0.2.6 | MIT OR Apache-2.0 | `CARGO_CACHE/web_atoms-0.2.6/Cargo.toml`; `CARGO_CACHE/web_atoms-0.2.6/LICENSE-APACHE`; `CARGO_CACHE/web_atoms-0.2.6/LICENSE-MIT` |
| webkit2gtk | 2.0.2 | MIT | `CARGO_CACHE/webkit2gtk-2.0.2/Cargo.toml`; `CARGO_CACHE/webkit2gtk-2.0.2/LICENSE` |
| webkit2gtk-sys | 2.0.2 | MIT | `CARGO_CACHE/webkit2gtk-sys-2.0.2/Cargo.toml`; `CARGO_CACHE/webkit2gtk-sys-2.0.2/LICENSE` |
| webpki-root-certs | 1.0.9 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| webview2-com | 0.38.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| webview2-com-macros | 0.8.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| webview2-com-sys | 0.38.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| winapi | 0.3.9 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| winapi-i686-pc-windows-gnu | 0.4.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| winapi-util | 0.1.11 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| winapi-x86_64-pc-windows-gnu | 0.4.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| window-vibrancy | 0.6.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows | 0.61.3 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-collections | 0.2.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-core | 0.61.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-core | 0.62.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-future | 0.2.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-implement | 0.60.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-interface | 0.59.3 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-link | 0.1.3 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-link | 0.2.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-numerics | 0.2.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-registry | 0.6.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-result | 0.3.4 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-result | 0.4.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-strings | 0.4.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-strings | 0.5.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-sys | 0.45.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-sys | 0.52.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-sys | 0.59.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-sys | 0.60.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-sys | 0.61.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-targets | 0.42.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-targets | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-targets | 0.53.5 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-threading | 0.1.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows-version | 0.1.7 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_aarch64_gnullvm | 0.42.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_aarch64_gnullvm | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_aarch64_gnullvm | 0.53.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_aarch64_msvc | 0.42.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_aarch64_msvc | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_aarch64_msvc | 0.53.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_i686_gnu | 0.42.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_i686_gnu | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_i686_gnu | 0.53.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_i686_gnullvm | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_i686_gnullvm | 0.53.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_i686_msvc | 0.42.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_i686_msvc | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_i686_msvc | 0.53.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_gnu | 0.42.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_gnu | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_gnu | 0.53.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_gnullvm | 0.42.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_gnullvm | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_gnullvm | 0.53.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_msvc | 0.42.2 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_msvc | 0.52.6 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| windows_x86_64_msvc | 0.53.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| winnow | 0.5.40 | MIT | `CARGO_CACHE/winnow-0.5.40/Cargo.toml`; `CARGO_CACHE/winnow-0.5.40/LICENSE-MIT` |
| winnow | 0.7.15 | MIT | `CARGO_CACHE/winnow-0.7.15/Cargo.toml`; `CARGO_CACHE/winnow-0.7.15/LICENSE-MIT` |
| winnow | 1.0.4 | MIT | `CARGO_CACHE/winnow-1.0.4/Cargo.toml`; `CARGO_CACHE/winnow-1.0.4/LICENSE-MIT` |
| winreg | 0.55.0 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| wit-bindgen | 0.57.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| writeable | 0.6.4 | Unicode-3.0 | `CARGO_CACHE/writeable-0.6.4/Cargo.toml`; `CARGO_CACHE/writeable-0.6.4/LICENSE` |
| wry | 0.55.1 | Apache-2.0 OR MIT | `CARGO_CACHE/wry-0.55.1/Cargo.toml`; `CARGO_CACHE/wry-0.55.1/.license_template`; `CARGO_CACHE/wry-0.55.1/LICENSE-APACHE`; `CARGO_CACHE/wry-0.55.1/LICENSE-MIT`; `CARGO_CACHE/wry-0.55.1/LICENSE.spdx` |
| x11 | 2.21.0 | MIT | `CARGO_CACHE/x11-2.21.0/Cargo.toml`; `CARGO_CACHE/x11-2.21.0/LICENSE-MIT` |
| x11-dl | 2.21.0 | MIT | `CARGO_CACHE/x11-dl-2.21.0/Cargo.toml`; `CARGO_CACHE/x11-dl-2.21.0/LICENSE-MIT` |
| xattr | 1.6.1 | MIT OR Apache-2.0 | `CARGO_CACHE/xattr-1.6.1/Cargo.toml`; `CARGO_CACHE/xattr-1.6.1/LICENSE-APACHE`; `CARGO_CACHE/xattr-1.6.1/LICENSE-MIT` |
| yoke | 0.8.3 | Unicode-3.0 | `CARGO_CACHE/yoke-0.8.3/Cargo.toml`; `CARGO_CACHE/yoke-0.8.3/LICENSE` |
| yoke-derive | 0.8.2 | Unicode-3.0 | `CARGO_CACHE/yoke-derive-0.8.2/Cargo.toml`; `CARGO_CACHE/yoke-derive-0.8.2/LICENSE` |
| zbus | 5.19.0 | MIT | `CARGO_CACHE/zbus-5.19.0/Cargo.toml`; `CARGO_CACHE/zbus-5.19.0/LICENSE` |
| zbus_macros | 5.19.0 | MIT | `CARGO_CACHE/zbus_macros-5.19.0/Cargo.toml`; `CARGO_CACHE/zbus_macros-5.19.0/LICENSE` |
| zbus_names | 4.3.4 | MIT | `CARGO_CACHE/zbus_names-4.3.4/Cargo.toml`; `CARGO_CACHE/zbus_names-4.3.4/LICENSE` |
| zcheapstr | 1.1.0 | MIT | `CARGO_CACHE/zcheapstr-1.1.0/Cargo.toml`; `CARGO_CACHE/zcheapstr-1.1.0/LICENSE` |
| zerocopy | 0.8.56 | BSD-2-Clause OR Apache-2.0 OR MIT | `CARGO_CACHE/zerocopy-0.8.56/Cargo.toml`; `CARGO_CACHE/zerocopy-0.8.56/LICENSE-APACHE`; `CARGO_CACHE/zerocopy-0.8.56/LICENSE-BSD`; `CARGO_CACHE/zerocopy-0.8.56/LICENSE-MIT` |
| zerocopy-derive | 0.8.56 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| zerofrom | 0.1.8 | Unicode-3.0 | `CARGO_CACHE/zerofrom-0.1.8/Cargo.toml`; `CARGO_CACHE/zerofrom-0.1.8/LICENSE` |
| zerofrom-derive | 0.1.7 | Unicode-3.0 | `CARGO_CACHE/zerofrom-derive-0.1.7/Cargo.toml`; `CARGO_CACHE/zerofrom-derive-0.1.7/LICENSE` |
| zeroize | 1.9.0 | Apache-2.0 OR MIT | `CARGO_CACHE/zeroize-1.9.0/Cargo.toml`; `CARGO_CACHE/zeroize-1.9.0/LICENSE-APACHE`; `CARGO_CACHE/zeroize-1.9.0/LICENSE-MIT` |
| zeroize_derive | 1.5.0 | Apache-2.0 OR MIT | `CARGO_CACHE/zeroize_derive-1.5.0/Cargo.toml`; `CARGO_CACHE/zeroize_derive-1.5.0/LICENSE-APACHE`; `CARGO_CACHE/zeroize_derive-1.5.0/LICENSE-MIT` |
| zerotrie | 0.2.5 | Unicode-3.0 | `CARGO_CACHE/zerotrie-0.2.5/Cargo.toml`; `CARGO_CACHE/zerotrie-0.2.5/LICENSE` |
| zerovec | 0.11.7 | Unicode-3.0 | `CARGO_CACHE/zerovec-0.11.7/Cargo.toml`; `CARGO_CACHE/zerovec-0.11.7/LICENSE` |
| zerovec-derive | 0.11.4 | Unicode-3.0 | `CARGO_CACHE/zerovec-derive-0.11.4/Cargo.toml`; `CARGO_CACHE/zerovec-derive-0.11.4/LICENSE` |
| zip | 4.6.1 | UNKNOWN — source not cached | Lock source: `registry+https://github.com/rust-lang/crates.io-index`; no cached source/notice observed |
| zmij | 1.0.23 | MIT | `CARGO_CACHE/zmij-1.0.23/Cargo.toml`; `CARGO_CACHE/zmij-1.0.23/LICENSE-MIT` |
| zvariant | 5.14.0 | MIT | `CARGO_CACHE/zvariant-5.14.0/Cargo.toml`; `CARGO_CACHE/zvariant-5.14.0/LICENSE` |
| zvariant_derive | 5.14.0 | MIT | `CARGO_CACHE/zvariant_derive-5.14.0/Cargo.toml`; `CARGO_CACHE/zvariant_derive-5.14.0/LICENSE` |
| zvariant_utils | 4.1.0 | MIT | `CARGO_CACHE/zvariant_utils-4.1.0/Cargo.toml`; `CARGO_CACHE/zvariant_utils-4.1.0/LICENSE` |

### Cached combined notices: specific follow-up observations

These are notice/source observations, not a target/feature-resolved binary SBOM:

- `encoding_rs 0.8.35`: `CARGO_CACHE/encoding_rs-0.8.35/COPYRIGHT`
  separately identifies WHATWG-derived encoding data under BSD-3-Clause.
  Preserve `LICENSE-WHATWG` in addition to the selected MIT/Apache branch;
  a single crate-level OR expression does not describe all included data.
- `ring 0.17.14`: its root `LICENSE` points to `LICENSE-other-bits`,
  `LICENSE-BoringSSL`, per-file source notices and
  `src/polyfill/once_cell/LICENSE-APACHE` / `LICENSE-MIT`. These are under
  `CARGO_CACHE/ring-0.17.14/`; do not collapse the component to an ISC label.
  Applicable combined notices depend on the final linked source/target.
- `libsqlite3-sys 0.28.0`: wrapper `LICENSE` is MIT, while
  `CARGO_CACHE/libsqlite3-sys-0.28.0/sqlite3/sqlite3.c` identifies SQLite
  3.45.0, Fossil check-in `1066602b2b1976fe58b5150777cced894af1`, and a
  source copyright disclaimer. The manifest enables bundled SQLite; do not
  describe the C payload as simply wrapper MIT or invent a license fee.

## Targeted follow-up: source helpers, remote assets and scope

The checked-in lockfiles were reviewed for this inventory. The root
`bun.lock` contains 660 resolution records / 653 unique name@version identities;
578 identities had matching installed manifests inspected and 75 did not.
`src-ssr/bun.lock` has 93 records / 85 identities and `src-capacitor/bun.lock`
has 112 / 112. The latter two were counted, not fully cleared. Root direct rows
above match the candidate installed metadata; the explicitly historical
transitive rows remain historical. The candidate `ts-mls` is 1.6.4 and MIT,
not BSD. A stale physical installation is not lock membership.

| Retained source helper | Provenance / notice status |
| --- | --- |
| `scripts/bundler-tools/linuxdeploy-plugin-gtk.sh` | Modified tauri-apps/linuxdeploy-plugin-gtk copy. MIT; Copyright 2018-2019 TheAssassin and the linuxdeploy contributors. Full upstream text in `scripts/bundler-tools/linuxdeploy-plugin-gtk.LICENSE.txt`. Reviewed license at upstream revision `dda522bce37387f1b853d9095713bfaa924c8423`; historical imported revision NOT established. Local header records modifications. See `THIRD_PARTY.md` for the exact evidence URL. |
| `flatpak/flatpak-cargo-generator.py` | Unchanged flatpak/flatpak-builder-tools Cargo generator, Git blob `0b5744a366d0750fb6a04811db6d52f1f74df95b`, verified at file-changing commit `41c20aa10819cdb2a4f3ca171758a96d1955c018`. MIT declared in the file and upstream project metadata; adjacent `flatpak/flatpak-cargo-generator.LICENSE.txt` retains permission/warranty text without inventing a copyright holder. Upstream copyright attribution incomplete. Retained reference is still source-redistributed. |
| `scripts/bundler-tools/mourn-gstreamer-bundle.sh` and `linuxdeploy-plugin-gstreamer.sh` | Newly authored AGPL-3.0-only adapter plus original compatibility launcher replace the previous copied implementation. Public interface sources are recorded in the adapter header. Real ELF/media tests use a synthetic dependency resolver and host libraries, not a completed AppImage payload or legal certification. |

| Runtime-requested material | Observed use / attribution / boundary |
| --- | --- |
| Twemoji 15.1.0 graphics from jdecked/twemoji via jsDelivr | `src/utils/messagingEmoji.ts:40-54` builds upstream SVG URLs used by messaging components; no SVG alteration in this path. Graphics CC-BY-4.0, separate from MIT software. Attribution, project/source and license links are in `THIRD_PARTY.md`. Remote SVG collection is not vendored in this snapshot; retain attribution in accessible built acknowledgements. |
| User-selected Google Fonts / uploaded fonts | `src/utils/googleFonts.ts` constructs remote stylesheet requests or accepts user uploads. This does not establish that arbitrary remote font files are shipped in this source snapshot or that all user fonts share one license. Per-font and user-input rights remain separate. |
| KLIPY media | Messaging components request search/media at runtime with existing Powered by KLIPY labels. Provider/service/API terms and individual media rights require separate review; no provider-wide permission is inferred. |

The tracked public/source/icon ledger covers 41 asset/support files, including
font license/provenance documents and HTML/CSS/JS, plus the two embedded
representations recorded above. This is 43 ledger records, not 43 distinct media
works. The starfield image is loaded by `src/components/graveyard/VoidScene.vue`;
no application consumer was found for the QR/wallet images in the bounded
review, but unused tracked assets are still source-redistributed. The matching
embedded/public notification bytes establish duplication, not authorship.
Preferred modification sources for team audio/art and any samples/derivations
still require author confirmation; no creation identity or license is guessed.

Source snapshots include retained tracked files even when they are build-only,
reference-only or unused by the runtime. Lockfiles do not themselves vendor
those dependencies. Conversely `frontendDist: ../dist/spa` does not automatically
ship repository-root notices: AppImage media bundling, Debian system dependency
declarations and Flatpak GNOME runtime use are different redistribution sets.
The five enabled Quasar extras families require their applicable full notices in
a built distribution; MDI's summary additionally references Apache text and
constituent-license caveats. No native/runtime notice bundle or payload was
assembled or verified in this documentation-only follow-up.

## Outstanding distribution work (not performed)

- Keep GSAP excluded unless a future dependency addition receives its own compatibility review.
- Obtain missing Rust sources/notices using a separately authorized process; inspect native components, enabled targets/features and actual shipped payloads.
- Reconcile installed JS packages with the selected lockfile, then inventory the complete transitive graph and embedded component notices; metadata alone does not prove compatibility.
- Map all non-font assets to owner, original source, modifications, permission and required notices; retain the team statement without extending it to unknown works.
- Assemble and verify a distributable notice/license bundle. Having a license in node_modules or the Cargo cache does not demonstrate that release artifacts include it.
- Review remote media/font/GIF/provider terms, vendored helpers, independent contributors, mobile native packages and screenshots separately. No external terms or historical copying audit was performed.
