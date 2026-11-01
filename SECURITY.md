# Security policy and threat boundaries

## Reporting

Do not post credentials, private messages, key material, or exploit details in a
public issue. Report privately to the approved security contacts:
`cross@mourn.bio` and `psycho@mourn.bio`. Include affected versions, impact, and
minimal reproduction steps with synthetic or redacted evidence. Ask how to
transfer sensitive evidence securely before sending it; no encryption key is
published here.
There is no verified response-time commitment or supported-version policy yet.
Public support questions belong in [SUPPORT.md](SUPPORT.md).

## What the frontend does and does not guarantee

- API authorization, account/device ownership, CSRF verification, membership,
  rate limiting, and encrypted-message expiry are backend controls. This client
  cannot establish that they are correctly deployed. The remediation did not
  contact or modify the production backend.
- Direct messaging is a custom Double-Ratchet-style construction, not Signal
  interoperability or an independently verified protocol implementation. Suites
  use `ts-mls`; a library name is not an end-to-end security audit.
- Transport security depends on configured endpoints, TLS and the native/browser
  stack. Certificate inspection helpers are not proof that every JS request is
  certificate-pinned. The relay sees routing/timing/device metadata.
- Ratchet records are encrypted with the native offline-vault key and bound to
  account/device/engine identity. Authentication failure does not authorize an
  implicit ratchet reset. Legacy migration writes the protected copy before
  deleting the old record.
- Direct and Suite **message history may be plaintext in origin-scoped IndexedDB**.
  E2EE on the wire does not make the whole local profile encrypted. Existing
  group/broadcast storage keys can also be accessible in the same origin. A
  compromised renderer or full OS-account access remains outside that protection.
- Cached attachments use ciphertext bound to account, conversation, message and
  retention scope. The attachment key is not stored with the cache. Decrypted
  object URLs exist in memory while previews are mounted. Explicitly saving a
  file exports plaintext to the user-selected location.
- Native credentials use OS secure storage; locked/unavailable storage errors
  must not be treated as an empty slot or a reason to overwrite existing keys.
  Saving a password for auto-login has its own device-security implications.
- New offline caches are account-scoped/context-authenticated. Legacy unscoped
  downloads are retained, not silently assigned to the next account. Re-download
  from an authorized backend or perform a separately validated owner migration.
- Profiles and user-selected media/fonts can request remote resources. Third-party
  providers receive ordinary network metadata; E2EE does not hide those requests.
- SQLite watcher logs are account-scoped locally. This is separation between
  normal account sessions, not authentication against a compromised main renderer.
  Legacy unscoped watcher rows are retained separately and not attributed to a
  newly signed-in user.

## Desktop and release safety

Only the main window receives credential/storage commands; the tray capability
is separate. File writes still require validation of dialog-mediated scopes on
Linux. Flatpak shares network access for the service but no host/home filesystem
access by default. Native package updates never invoke a privileged installer.
Downloaded `.deb` files are verified and handed to the user, **not installed**;
files may change after verification, so later privileged installation is a
separate trusted workflow. Flatpak rejects native updates and uses Flatpak itself.

Repository signing keys and service credentials must never be included in public
source or renderer configuration. Automated scans redact values and are a useful
check, not proof that all secrets or sensitive history have been found. Release
workflows build review artifacts only; publication and backend updater rollout
require separately authorized review.

## Required pre-release security validation

Use local/staging fixtures, not production accounts: account switching during
async work; keychain failures; corrupt/migrated storage; retention/wipe failures;
MLS membership changes and durable cursor/checkpoint recovery; offline network
recovery; native ACL enforcement and portal denial.
