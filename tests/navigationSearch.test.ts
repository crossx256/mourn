import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../src/boot/axios';
import { useNavigation } from '../src/composables/useNavigation';

vi.mock('quasar', () => ({ useQuasar: () => ({}) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('src/stores/auth', () => ({ useAuthStore: () => ({}) }));
vi.mock('src/stores/graveyard', () => ({ useGraveyardStore: () => ({}) }));
vi.mock('src/stores/notifications', () => ({ useNotificationsStore: () => ({}) }));
vi.mock('boot/axios', () => ({ api: { get: vi.fn() } }));

beforeEach(() => { vi.useFakeTimers(); vi.mocked(api.get).mockReset(); });
afterEach(async () => { useNavigation().closeSearch(); await vi.runAllTimersAsync(); vi.useRealTimers(); });

it('clears the header search and rejects a late response after focus leaves', async () => {
  const search = useNavigation();
  let finish: (() => void) | undefined;
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => {
    finish = () => resolve({ data: { success: true, data: [{ id: '1', username: 'cross' }] } });
  }));
  search.onSearchFocus();
  await search.onSearchInput('cross');
  await vi.advanceTimersByTimeAsync(300);
  search.onSearchBlur();
  await vi.advanceTimersByTimeAsync(120);
  expect(search.searchQuery.value).toBe('');
  finish?.();
  await Promise.resolve();
  expect(search.searchResults.value).toEqual([]);
  expect(search.isSearchFocused.value).toBe(false);
});

it('keeps the result actions available when focus moves within the search widget', async () => {
  const search = useNavigation();
  vi.mocked(api.get).mockResolvedValueOnce({ data: { success: true, data: [{ id: '1', username: 'cross' }] } });
  search.onSearchFocus();
  await search.onSearchInput('cross');
  await vi.advanceTimersByTimeAsync(300);
  search.onSearchBlur();
  search.onSearchFocus();
  await vi.advanceTimersByTimeAsync(120);
  expect(search.searchResults.value).toHaveLength(1);
  expect(search.isSearchFocused.value).toBe(true);
});
