import { mobilePlatform } from 'src/utils/platform';

/**
 * Thin wrapper over the local `BatteryOptimization` Capacitor plugin (Android only —
 * see BatteryOptimizationPlugin.java in the native project).
 *
 * Android moves an app it has not seen used for a while into a restricted standby
 * bucket, and a restricted app is delivered no FCM messages at all until it is
 * opened. Exempting the app from battery optimisation is what keeps background and
 * killed-app notifications arriving.
 */
export interface BatteryOptimizationResult {
  exempt: boolean;
  requested?: 'direct' | 'settings';
}

interface BatteryOptimizationPluginApi {
  isExempt(): Promise<{ exempt: boolean }>;
  requestExemption(): Promise<BatteryOptimizationResult>;
}

let pluginPromise: Promise<BatteryOptimizationPluginApi> | undefined;

function loadPlugin(): Promise<BatteryOptimizationPluginApi> {
  if (mobilePlatform() !== 'android') {
    return Promise.reject(new Error('Battery optimization is only available on Android'));
  }

  pluginPromise ??= import('@capacitor/core')
    .then(({ registerPlugin }) =>
      registerPlugin<BatteryOptimizationPluginApi>('BatteryOptimization'),
    )
    .catch((error: unknown) => {
      pluginPromise = undefined;
      throw error;
    });

  return pluginPromise;
}

const BatteryOptimization: BatteryOptimizationPluginApi = {
  async isExempt() {
    return (await loadPlugin()).isExempt();
  },
  async requestExemption() {
    return (await loadPlugin()).requestExemption();
  },
};

export default BatteryOptimization;
