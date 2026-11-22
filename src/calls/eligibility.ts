import type { Link } from 'src/types/links';
import { isUUID } from './codec';

/** UI hints only. The server and encrypted transport repeat authorization. */
export function showCallNavigation(nativeShell: boolean, loggedIn: boolean, enabled: boolean): boolean {
  return nativeShell && loggedIn && enabled;
}

export function canOfferVoiceCall(
  link: Link | null,
  userId: string | undefined,
  availability: { enabled: boolean; supported: boolean; ready: boolean },
  now: number,
  quarantined: Readonly<Record<string, unknown>> = {},
): boolean {
  if (!link || !userId || !availability.enabled || !availability.supported || !availability.ready) return false;
  if (!['ESTABLISHED', 'ANCHORED'].includes(link.status)) return false;
  if (link.status !== 'ANCHORED' && link.expiresAt !== null && !(Date.parse(link.expiresAt) > now)) return false;
  if (link.senderId === link.receiverId) return false;
  const peer = link.senderId === userId ? link.receiver : link.receiverId === userId ? link.sender : null;
  return !!peer?.devices?.some(device => isUUID(device.id) && !quarantined[device.id]
    && /^[0-9a-f]{64}$/i.test(device.devicePub) && /^[0-9a-f]{64}$/i.test(device.identityPub));
}
