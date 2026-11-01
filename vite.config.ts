import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { templateCompilerOptions } from '@tresjs/core';

// ///@ts-expect-error process is a nodejs global

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    vue({
      ...templateCompilerOptions,
      template: {
        ...templateCompilerOptions.template,
        compilerOptions: {
          ...templateCompilerOptions.template?.compilerOptions,
          comments: false,
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      src: fileURLToPath(new URL('./src', import.meta.url)),
      boot: fileURLToPath(new URL('./src/boot', import.meta.url)),
      stores: fileURLToPath(new URL('./src/stores', import.meta.url)),
      components: fileURLToPath(new URL('./src/components', import.meta.url)),
      layouts: fileURLToPath(new URL('./src/layouts', import.meta.url)),
      pages: fileURLToPath(new URL('./src/pages', import.meta.url)),
      types: fileURLToPath(new URL('./src/types', import.meta.url)),
      utils: fileURLToPath(new URL('./src/utils', import.meta.url)),
      composables: fileURLToPath(new URL('./src/composables', import.meta.url)),
      crypto: fileURLToPath(new URL('./src/utils/webcryptoShim.ts', import.meta.url)),
      services: fileURLToPath(new URL('./src/services', import.meta.url)),
    },
  },
  define: {
    __MOURN_DESKTOP_BUILD__: false,
  },

  // @hpke/* (pulled in via ts-mls) must not be pre-bundled by the dep
  // optimizer: esbuild resolves their UMD/CJS-flavored entries to an empty
  // module, so ts-mls's dynamic imports (makeAead/makeDhKem) fail at runtime
  // with "Optional dependency ... is not installed" (the real error is
  // swallowed). Keeping them excluded serves the bare imports from the real
  // ESM files — see the same list in quasar.config.ts.
  optimizeDeps: {
    // ts-mls is only reached through the lazily-loaded messaging chunk; without
    // naming it up front the dev server discovers it late, re-optimizes deps and
    // answers the in-flight import with 504 (Outdated Optimize Dep). Same list as
    // quasar.config.ts.
    include: ['ts-mls'],
    exclude: [
      '@hpke/core',
      '@hpke/common',
      '@hpke/chacha20poly1305',
      '@hpke/dhkem-x448',
      '@hpke/hybridkem-x-wing',
      '@hpke/ml-kem',
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}));
