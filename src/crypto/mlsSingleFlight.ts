// Coalesce duplicate HTTP/WS onboarding work without caching failed attempts.
export function mlsSingleFlight<T>() {
  const pending = new Map<string, Promise<T>>();
  return (key: string, operation: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const result = Promise.resolve().then(operation).finally(() => {
      if (pending.get(key) === result) pending.delete(key);
    });
    pending.set(key, result);
    return result;
  };
}
