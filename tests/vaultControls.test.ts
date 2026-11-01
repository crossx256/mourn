import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useVaultStore } from '../src/stores/vault';

beforeEach(() => { setActivePinia(createPinia()); });
describe('decrypted Vault control ownership', () => {
  it('cannot erase another sender\'s message using a forged delete payload', () => {
    const vault = useVaultStore();
    vault.messages.link = [{ id: 'message', senderId: 'alice', isSender: true, senderDeviceId: 'device-a', plaintext: 'hi', timestamp: Date.now() }];
    const remove = vi.spyOn(vault, 'deleteMessageById').mockResolvedValue(true);
    expect(vault.handleControlMessage('link', JSON.stringify({ v: 1, type: 'delete', targetId: 'message', sender: 'alice' }), 'bob')).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    vault.handleControlMessage('link', JSON.stringify({ v: 1, type: 'delete', targetId: 'message' }), 'alice');
    expect(remove).toHaveBeenCalledWith('link', 'message');
  });
  it('takes reaction ownership from the authenticated frame, not JSON.sender', () => {
    const vault = useVaultStore();
    vault.messages.link = [{ id: 'message', senderId: 'alice', isSender: true, senderDeviceId: 'device-a', plaintext: 'hi', timestamp: Date.now() }];
    const react = vi.spyOn(vault, 'toggleReaction').mockResolvedValue(undefined);
    vault.handleControlMessage('link', JSON.stringify({ v: 1, type: 'reaction', targetId: 'message', emoji: '👍', sender: 'alice' }), 'bob');
    expect(react).toHaveBeenCalledWith('link', 'message', '👍', 'bob', false);
  });
});
