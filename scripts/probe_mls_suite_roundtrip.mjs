// Probe: does a serialized MLS group state carry its OWN ciphersuite, and can
// that suite be resolved back into a working impl after the build default moved
// from AES-256-GCM to ChaCha20-Poly1305?
//
// This is the assumption the "old suites must keep working across updates" fix
// rests on. Run: node scripts/probe_mls_suite_roundtrip.mjs
import {
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  nobleCryptoProvider,
  generateKeyPackage,
  createGroup,
  encodeGroupState,
  decodeGroupState,
  emptyPskIndex,
  defaultKeyRetentionConfig,
  defaultLifetimeConfig,
  defaultKeyPackageEqualityConfig,
  defaultPaddingConfig,
  defaultAuthenticationService,
} from 'ts-mls';

const AES = 'MLS_256_MLKEM768_AES256GCM_SHA384_Ed25519';
const CHACHA = 'MLS_256_MLKEM768_CHACHA20POLY1305_SHA384_Ed25519';

const clientConfig = {
  keyRetentionConfig: defaultKeyRetentionConfig,
  lifetimeConfig: defaultLifetimeConfig,
  keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
  paddingConfig: defaultPaddingConfig,
  authService: defaultAuthenticationService,
};

const capabilities = (suite) => ({
  versions: ['mls10'],
  ciphersuites: [suite],
  extensions: [],
  proposals: [1, 2, 3],
  credentials: ['basic'],
});

const lifetime = () => {
  const now = Math.floor(Date.now() / 1000);
  return { notBefore: BigInt(now - 60), notAfter: BigInt(now + 60 * 60 * 24 * 365 * 10) };
};

/** Build a real group under an explicit ciphersuite (mirrors MlsGroupClient.create). */
async function buildGroup(suiteName) {
  const impl = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName), nobleCryptoProvider);
  const { publicPackage, privatePackage } = await generateKeyPackage(
    { credentialType: 'basic', identity: new TextEncoder().encode('probe-device') },
    capabilities(suiteName),
    lifetime(),
    [],
    impl,
  );
  const state = await createGroup(
    new TextEncoder().encode('probe-group'),
    publicPackage,
    privatePackage,
    [],
    impl,
    clientConfig,
  );
  return { impl, state };
}

const results = {};

// (1) Both suites are actually implemented by the pinned ts-mls build — a legacy
// group can therefore still be driven after the default moved on.
for (const suite of [AES, CHACHA]) {
  const impl = await getCiphersuiteImpl(getCiphersuiteFromName(suite), nobleCryptoProvider);
  results[`impl_${suite}`] = { resolved: Boolean(impl), reportedName: impl?.name ?? null };
}

// (2) A serialized state self-describes its suite and decodes with NO impl.
for (const suite of [AES, CHACHA]) {
  const { state } = await buildGroup(suite);
  const encoded = encodeGroupState(state);
  const decoded = decodeGroupState(encoded, 0);
  const round = decoded ? decoded[0] : null;
  results[`roundtrip_${suite}`] = {
    bytes: encoded.length,
    decodedOk: Boolean(round),
    decodedSuite: round?.groupContext?.cipherSuite ?? null,
    suitePreserved: round?.groupContext?.cipherSuite === suite,
    epoch: round ? String(round.groupContext.epoch) : null,
  };
}

// (3) End-to-end: an AES serialized state -> read suite -> resolve impl -> re-encode.
// Proves the exact plumbing groupStore.loadMlsClient now uses.
{
  const { state } = await buildGroup(AES);
  const serialized = Buffer.from(encodeGroupState(state)).toString('base64');
  const bytes = Uint8Array.from(Buffer.from(serialized, 'base64'));
  const decoded = decodeGroupState(bytes, 0);
  const suiteFromState = decoded?.[0]?.groupContext?.cipherSuite ?? null;
  const impl = await getCiphersuiteImpl(getCiphersuiteFromName(suiteFromState), nobleCryptoProvider);
  const reDecoded = decodeGroupState(encodeGroupState(decoded[0]), 0);
  results.legacy_load_path = {
    suiteFromState,
    implName: impl.name,
    implMatchesState: impl.name === suiteFromState,
    secondRoundTripSuite: reDecoded?.[0]?.groupContext?.cipherSuite ?? null,
  };
}

console.log(JSON.stringify(results, null, 2));
