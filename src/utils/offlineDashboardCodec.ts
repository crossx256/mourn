/**
 * Offline dashboard codec — serialize the DashboardData payload to/from bytes
 * for the encrypted offline vault, so the dashboard can still render the user's
 * profile/state when the network is unavailable (desktop only).
 */
import type { DashboardData } from 'src/types/dashboard';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Serialize DashboardData into UTF-8 bytes for the offline vault. */
export function encodeDashboardPayload(data: DashboardData): Uint8Array {
  return encoder.encode(JSON.stringify(data));
}

/** Deserialize offline-vault bytes back into DashboardData. Throws on malformed JSON. */
export function decodeDashboardPayload(bytes: Uint8Array): DashboardData {
  return JSON.parse(decoder.decode(bytes)) as DashboardData;
}
