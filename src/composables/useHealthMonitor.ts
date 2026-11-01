import { ref, computed } from 'vue';
import { resolveApiUrl } from 'src/boot/axios';

/**
 * useHealthMonitor — Monitor backend health and online/offline status.
 *
 * This is intentionally conservative. The endpoint can touch backend
 * dependencies, so checks are backoff-based and never trigger navigation.
 */

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  checks: {
    database: {
      status: 'healthy' | 'unhealthy' | 'unknown';
      latency: number | null;
      error: string | null;
    };
    redis: {
      status: 'healthy' | 'unhealthy' | 'unknown';
      latency: number | null;
      error: string | null;
    };
  };
}

const HEALTH_CHECK_BASE_INTERVAL_MS = 60_000;
const HEALTH_CHECK_OFFLINE_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 8_000;
const RECOVERY_SUCCESS_THRESHOLD = 2;

const isOnline = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
const isBackendHealthy = ref<boolean>(true);
const lastHealthCheck = ref<HealthStatus | null>(null);
const consecutiveFailures = ref(0);
const consecutiveSuccesses = ref(0);

let healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupListeners: (() => void) | null = null;
let inFlightHealthCheck: Promise<boolean> | null = null;
let monitorRefCount = 0;

function nextIntervalMs(): number {
  if (consecutiveFailures.value > 0) return HEALTH_CHECK_OFFLINE_INTERVAL_MS;
  return HEALTH_CHECK_BASE_INTERVAL_MS;
}

function clearHealthTimer(): void {
  if (healthCheckTimer) {
    clearTimeout(healthCheckTimer);
    healthCheckTimer = null;
  }
}

function scheduleNextCheck(runCheck: () => void, delayMs = nextIntervalMs()): void {
  clearHealthTimer();
  healthCheckTimer = setTimeout(runCheck, delayMs);
}

async function performHealthCheck(): Promise<boolean> {
  if (typeof fetch === 'undefined' || typeof window === 'undefined') return false;

  if (!navigator.onLine) {
    return false;
  }

  if (document.visibilityState === 'hidden') {
    return isBackendHealthy.value;
  }

  if (inFlightHealthCheck) return inFlightHealthCheck;

  inFlightHealthCheck = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    try {
      const response = await fetch(resolveApiUrl('/api/health'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn('[Health Monitor] Backend health check returned:', response.status);
        return false;
      }

      try {
        lastHealthCheck.value = (await response.json()) as HealthStatus;
      } catch {
        // Could not parse JSON, but status is 200 so consider it healthy.
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[Health Monitor] Health check failed:', message);
      return false;
    } finally {
      window.clearTimeout(timeout);
      inFlightHealthCheck = null;
    }
  })();

  return inFlightHealthCheck;
}

/**
 * Initialize health monitoring.
 */
export function useHealthMonitor() {
  if (typeof window === 'undefined') {
    return {
      isOnline,
      isBackendHealthy,
      isOffline: computed(() => false),
      startMonitoring: () => {},
      stopMonitoring: () => {},
      retryNow: () => {},
      lastHealthCheck,
      consecutiveFailures,
    };
  }

  const isOffline = computed((): boolean => {
    return !isOnline.value || !isBackendHealthy.value;
  });

  const applyHealthResult = (healthy: boolean): void => {
    if (healthy) {
      consecutiveFailures.value = 0;
      consecutiveSuccesses.value += 1;

      if (!isBackendHealthy.value && consecutiveSuccesses.value >= RECOVERY_SUCCESS_THRESHOLD) {
        isBackendHealthy.value = true;
      } else if (isBackendHealthy.value) {
        isBackendHealthy.value = true;
      }

      return;
    }

    consecutiveSuccesses.value = 0;
    consecutiveFailures.value += 1;

    // Avoid flickering maintenance state on a single transient packet loss.
    if (consecutiveFailures.value >= 2) {
      isBackendHealthy.value = false;
    }
  };

  const runCheck = (): void => {
    void performHealthCheck()
      .then(applyHealthResult)
      .finally(() => {
        if (monitorRefCount > 0) scheduleNextCheck(runCheck);
      });
  };

  /** Force an immediate health check (used by the "click to retry now" label). */
  const retryNow = (): void => {
    if (typeof window === 'undefined') return;
    consecutiveFailures.value = 0;
    consecutiveSuccesses.value = 0;
    clearHealthTimer();
    void performHealthCheck()
      .then(applyHealthResult)
      .finally(() => {
        if (monitorRefCount > 0) scheduleNextCheck(runCheck);
      });
  };

  const startMonitoring = (): void => {
    monitorRefCount += 1;
    if (healthCheckTimer) return;

    scheduleNextCheck(runCheck, 5_000);

    const handleOnline = (): void => {
      console.log('[Health Monitor] Browser network restored');
      isOnline.value = true;
      consecutiveFailures.value = 0;
      consecutiveSuccesses.value = 0;
      scheduleNextCheck(runCheck, 1_000);
    };

    const handleOffline = (): void => {
      console.log('[Health Monitor] Browser network lost');
      isOnline.value = false;
      consecutiveSuccesses.value = 0;
      clearHealthTimer();
    };

    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible' && isOnline.value) {
        scheduleNextCheck(runCheck, 1_000);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    cleanupListeners = (): void => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  };

  const stopMonitoring = (): void => {
    monitorRefCount = Math.max(0, monitorRefCount - 1);
    if (monitorRefCount > 0) return;

    clearHealthTimer();
    cleanupListeners?.();
    cleanupListeners = null;
  };

  return {
    isOnline,
    isBackendHealthy,
    isOffline,
    startMonitoring,
    stopMonitoring,
    retryNow,
    lastHealthCheck,
    consecutiveFailures,
  };
}
