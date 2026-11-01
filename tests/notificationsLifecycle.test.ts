import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '../src/boot/axios';
import { useAuthStore } from '../src/stores/auth';
import { useNotificationsStore } from '../src/stores/notifications';

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
});
afterEach(() => vi.restoreAllMocks());

it('does not repopulate private notifications after an account switch/reset', async () => {
  let finish!: (response: unknown) => void;
  vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const store = useNotificationsStore();
  const request = store.fetchNotifications();
  Object.assign(useAuthStore(), { user: { id: 'bob' }, authOperationGeneration: 1 });
  store.$reset();
  finish({ data: { data: [{ id: 'private-alice', isRead: true }] } });
  await expect(request).rejects.toThrow('superseded');
  expect(store.notifications).toEqual([]);
  expect(store.loading).toBe(false);
});

it('does not send an old account mutation after CSRF refresh resumes in a new account', async () => {
  let finish!: () => void;
  vi.spyOn(useAuthStore(), 'fetchCsrfToken').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } });
  const request = useNotificationsStore().markAsRead('alice-notification');
  Object.assign(useAuthStore(), { user: { id: 'bob' }, authOperationGeneration: 1 });
  finish();
  await expect(request).rejects.toThrow('superseded');
  expect(post).not.toHaveBeenCalled();
});
