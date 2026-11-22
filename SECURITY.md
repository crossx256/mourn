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

## Voice calls

- Calls use a dedicated, device-addressed encrypted signalling channel, not chat
  messages or the legacy plaintext RTC relay. Call keys are domain-separated
  from direct-message keys. This remains Mourn's custom protocol, not Signal or
  RingRTC compatibility or an independently audited cryptographic construction.
- Signalling is memory-only: SDP, ICE, their encrypted envelopes and call-session
  ratchet state must not enter message history, persistent relay queues, recovery
  journals, push payloads or telemetry. Bounded online retries use RAM only.
  Restarting the app loses negotiation state; interrupted calls require fresh setup.
- Call-history metadata is separate from signalling and has a 90-day server
  retention limit with per-user clearing. The relay still observes routing and
  timing metadata. Metadata-only incoming-call notifications are not acceptance.
- Media uses WebRTC DTLS-SRTP. Direct connections can disclose network addresses
  to the peer; relay-only mode must never fall back to a direct candidate. TURN
  sees transport metadata but is not given media encryption keys.
- Receiving an offer does not grant microphone consent. Native permissions,
  background/locked-screen behavior, audio routing and public-network relay
  operation require platform qualification before rollout. Calls are disabled
  by default; unit tests and browser fixtures do not establish native readiness.

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
