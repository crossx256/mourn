import type { ServerCall } from 'src/calls/types';

const endLabels: Record<string, string> = {
  normal: 'Call ended', declined: 'Declined', busy: 'Busy', timeout: 'No answer',
  failed: 'Could not connect', unavailable: 'Calls unavailable', cancelled: 'Cancelled',
  'answered-elsewhere': 'Answered on another device', 'link-severed': 'Link closed',
  'link-expired': 'Link expired', 'device-revoked': 'Device access revoked',
  ineligible: 'Contact unavailable', lost: 'Connection lost', 'max-duration': 'Call ended (4 hour limit)',
};
export function endLabel(reason: string, incoming = false): string {
  return reason === 'timeout' && incoming ? 'Missed call' : (endLabels[reason] ?? 'Call ended');
}
export function callDuration(call: Pick<ServerCall, 'answeredAt' | 'endedAt'>, now = Date.now()): string {
  const start = Date.parse(call.answeredAt ?? '');
  const end = call.endedAt ? Date.parse(call.endedAt) : now;
  const seconds = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function historyStatus(call: ServerCall, incoming: boolean): string {
  if (call.endReason) return endLabel(call.endReason, incoming);
  return ({ RINGING: 'Unanswered', ACTIVE: 'In progress', ENDED: 'Call ended', MISSED: incoming ? 'Missed call' : 'No answer', DECLINED: 'Declined', BUSY: 'Busy', CANCELLED: 'Cancelled', FAILED: 'Could not connect' } as Record<string, string>)[call.state] ?? 'Call ended';
}
