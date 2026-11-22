import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const bridge = vi.hoisted(() => ({
  registerPlugin: vi.fn(() => ({ requestMicPermission: vi.fn(async () => ({ granted: true })) })),
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
}));
vi.mock('@capacitor/core', () => ({
  registerPlugin: bridge.registerPlugin,
  Capacitor: { isNativePlatform: bridge.isNativePlatform, getPlatform: bridge.getPlatform },
}));
import { AndroidCalls, isAndroidCallsPlatform } from '../../src/calls/android';
const java = (name: string) => readFileSync(new URL(`../../src-capacitor/android/app/src/main/java/bio/mourn/mobile/calls/${name}.java`, import.meta.url), 'utf8');

describe('Android call bridge contract', () => {
  beforeEach(() => { vi.stubGlobal('window', { Capacitor: { isNativePlatform: bridge.isNativePlatform, getPlatform: bridge.getPlatform } }); bridge.isNativePlatform.mockReturnValue(false); bridge.getPlatform.mockReturnValue('web'); });
  it('loads the native plugin only on first Android command and is never thenable', async () => {
    expect(bridge.registerPlugin).not.toHaveBeenCalled();
    expect((AndroidCalls as any).then).toBeUndefined();
    expect(await Promise.resolve(AndroidCalls)).toBe(AndroidCalls);
    await expect(AndroidCalls.requestMicPermission()).rejects.toThrow('ANDROID_CALLS_UNAVAILABLE');
    expect(bridge.registerPlugin).not.toHaveBeenCalled();
    bridge.isNativePlatform.mockReturnValue(true); bridge.getPlatform.mockReturnValue('android');
    await expect(AndroidCalls.requestMicPermission()).resolves.toEqual({ granted: true });
    expect(bridge.registerPlugin).toHaveBeenCalledExactlyOnceWith('MournCalls');
  });
  it('is available only for native Android, not desktop/web/iOS', () => {
    expect(isAndroidCallsPlatform()).toBe(false);
    bridge.getPlatform.mockReturnValue('android');
    expect(isAndroidCallsPlatform()).toBe(false);
    bridge.isNativePlatform.mockReturnValue(true);
    expect(isAndroidCallsPlatform()).toBe(true);
    bridge.getPlatform.mockReturnValue('ios');
    expect(isAndroidCallsPlatform()).toBe(false);
  });
  it('exports every native command named in the TS contract', () => {
    const methods = [...java('CallsPlugin').matchAll(/@PluginMethod public void (\w+)\(/g)].map((match) => match[1]).sort();
    expect(methods).toEqual([
      'cancelIncoming', 'getAudioDevices', 'getPendingActions', 'requestBluetoothPermission',
      'requestMicPermission', 'resetCallState', 'setIncomingEnabled', 'setAudioRoute', 'setMuted', 'showIncoming', 'startCallService', 'stopCallService',
    ].sort());
  });
  it('FCM delegates normal notifications and token refresh, but never starts the microphone', () => {
    const fcm = java('MournMessagingService');
    expect(fcm).toContain('extends MessagingService');
    expect(fcm).toContain('super.onMessageReceived(message)');
    expect(fcm).toContain('super.onNewToken(token)');
    expect(fcm).not.toMatch(/startForegroundService|startService\(/);
  });
  it('has an account-boundary reset that invalidates pending starts and all native action hints', () => {
    const plugin = java('CallsPlugin');
    expect(plugin).toContain('@PluginMethod public void resetCallState(PluginCall call)');
    expect(plugin).toContain('CallStore.reset(getContext())');
    const reset = java('CallStore').split('static synchronized void reset(Context c)')[1]?.split('static synchronized')[0];
    expect(reset).toContain('edit.remove(entry.getKey())');
    expect(reset).toContain('finish(c, id)');
    expect(reset).toContain('CallNotification.cancel(c, id)');
  });
  it('persists authenticated incoming eligibility fail-closed, and revokes it on reset', () => {
    const store = java('CallStore');
    expect(store).toContain('getBoolean("incomingEnabled", false)');
    expect(store).toContain('if (!incomingEnabled(c)) return false;');
    expect(store).toContain('prefs(c).edit().putBoolean("incomingEnabled", false)');
    expect(java('CallsPlugin')).toContain('@PluginMethod public void setIncomingEnabled(PluginCall call)');
  });
  it('persists alert preferences with eligibility and chooses independent sound/vibration channels', () => {
    expect(java('CallsPlugin')).toContain('CallStore.alertPreferences(getContext(),');
    expect(java('CallStore')).toContain('getBoolean("ringtoneSilent", false)');
    expect(java('CallStore')).toContain('getBoolean("vibrate", true)');
    expect(java('CallNotification')).toContain('CallStore.ringtoneSilent(c)');
    expect(java('CallNotification')).toContain('CallStore.vibrate(c)');
    expect(java('CallNotification')).toContain('SOUND_CHANNEL');
    expect(java('CallNotification')).toContain('VIBRATE_CHANNEL');
  });
  it('does not loop a ringtone on API 24/25 without OS notification timeout', () => {
    expect(java('CallNotification')).toContain('if (sound && CallPolicy.repeatRingtone(Build.VERSION.SDK_INT, quiet)) notification.flags |= Notification.FLAG_INSISTENT;');
  });
  it('notification answer launches the Activity directly, never a receiver trampoline', () => {
    expect(java('CallNotification')).toContain('answer = activity(c, id, "answer")');
    expect(java('CallActionReceiver')).not.toMatch(/startForegroundService|startActivity\(/);
  });
});
