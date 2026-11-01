import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Test tooling is isolated from the root build config and production .env files.
export default defineConfig({
  envDir: false,
  plugins: [vue()],
  resolve: {
    alias: {
      '#q-app': fileURLToPath(new URL('../node_modules/@quasar/app-vite/exports/wrappers.js', import.meta.url)),
      src: fileURLToPath(new URL('../src', import.meta.url)),
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      boot: fileURLToPath(new URL('../src/boot', import.meta.url)),
      stores: fileURLToPath(new URL('../src/stores', import.meta.url)),
      components: fileURLToPath(new URL('../src/components', import.meta.url)),
      crypto: fileURLToPath(new URL('../src/utils/webcryptoShim.ts', import.meta.url)),
    },
  },
  define: { __MOURN_DESKTOP_BUILD__: false, __MOURN_MOBILE_BUILD__: false, __MOURN_NATIVE_BUILD__: false, __MOURN_TARGET__: JSON.stringify('web'), 'import.meta.env.QUASAR_SERVER': false, 'import.meta.env.QUASAR_CLIENT': true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/crypto/__tests__/**/*.test.ts'],
    setupFiles: ['scripts/test_no_network.ts'],
    testTimeout: 30000,
    maxWorkers: 1, // Crypto transforms are memory-heavy on contributor machines.
  },
});
