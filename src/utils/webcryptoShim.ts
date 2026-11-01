// Browser-only adapter for dependencies that dynamically import Node's `crypto`.
// Native SubtleCrypto is mandatory: there is no secure browser-safe polyfill.
//
// iOS BLOCK-DO-NOT-SHIP / DEVICE-TEST WARNING: `server.iosScheme = "https"` is
// not proof that WKWebView exposes `globalThis.crypto.subtle`. Before any iOS
// release, verify SubtleCrypto on a physical device and exercise Vault and MLS
// cryptographic flows end to end. If SubtleCrypto is absent or any flow fails,
// do not ship. This shim intentionally provides no polyfill and fails closed.
const browserCrypto = globalThis.crypto;

if (!browserCrypto?.subtle) {
  throw new Error(
    'Web Crypto SubtleCrypto is unavailable; secure cryptographic operations cannot continue.',
  );
}

export const webcrypto = browserCrypto;
