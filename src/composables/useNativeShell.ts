import { ref, readonly, onMounted, onUnmounted } from 'vue';
import { isCapacitorRuntime, isTauriRuntime } from 'src/utils/platform';

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export interface ZoomGestureDetail {
  direction: 'in' | 'out';
  delta: number;
}

const bodyClassOwners = new Map<string, { count: number; preexisting: boolean }>();

export function useNativeShell() {
  const isTauri = ref(isTauriRuntime());
  const isCapacitor = ref(isCapacitorRuntime());
  const isNativeShell = ref(isTauri.value || isCapacitor.value);
  const ownedClasses: string[] = [];

  onMounted(() => {
    isTauri.value = isTauriRuntime();
    isCapacitor.value = isCapacitorRuntime();
    isNativeShell.value = isTauri.value || isCapacitor.value;

    for (const name of [isTauri.value ? 'is-tauri' : '', isCapacitor.value ? 'is-capacitor' : '']) {
      if (!name) continue;
      const owner = bodyClassOwners.get(name) ?? {
        count: 0,
        preexisting: document.body.classList.contains(name),
      };
      owner.count++;
      bodyClassOwners.set(name, owner);
      document.body.classList.add(name);
      ownedClasses.push(name);
    }
    // Keep browser/webview zoom accessible. Rust owns close/minimize-to-tray;
    // asynchronous logout during close or beforeunload cannot be awaited safely.
  });

  onUnmounted(() => {
    for (const name of ownedClasses) {
      const owner = bodyClassOwners.get(name);
      if (!owner || --owner.count > 0) continue;
      if (!owner.preexisting) document.body.classList.remove(name);
      bodyClassOwners.delete(name);
    }
  });

  return {
    isTauri: readonly(isTauri),
    isCapacitor: readonly(isCapacitor),
    isNativeShell: readonly(isNativeShell),
  };
}
