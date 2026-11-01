// Configuration for your app
// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '#q-app';
import { templateCompilerOptions } from '@tresjs/core';
import { CLIENT_THEMES_DEFINE } from './build/clientThemes';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(projectRoot, 'src');
const envTarget = process.env.MOURN_TARGET;
const isDesktopTarget = envTarget === 'desktop';
const existingIsCustomElement = templateCompilerOptions.template?.compilerOptions?.isCustomElement;
const widgetCompilerOptions = {
  ...templateCompilerOptions,
  template: {
    ...templateCompilerOptions.template,
    compilerOptions: {
      ...templateCompilerOptions.template?.compilerOptions,
      comments: false,
      isCustomElement: (tag: string) =>
        tag.startsWith('cap-') || Boolean(existingIsCustomElement?.(tag)),
    },
  },
};
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
  version?: string;
};

export default defineConfig((ctx) => {
  // Capacitor mode (quasar dev/build -m capacitor -T android|ios) IS the mobile
  // target — it needs no env var, which matters because `MOURN_TARGET=x cmd` is
  // not valid syntax in cmd.exe/PowerShell. The env var stays supported so the
  // desktop SPA build (MOURN_TARGET=desktop quasar build -m spa) is unchanged.
  const capacitorMode = Boolean((ctx.mode as Record<string, unknown> | undefined)?.capacitor);
  const isMobileTarget = capacitorMode || envTarget === 'mobile';
  const isNativeTarget = isDesktopTarget || isMobileTarget;
  const mournTarget = isDesktopTarget ? 'desktop' : isMobileTarget ? 'mobile' : 'web';

  return {
    // https://v2.quasar.dev/quasar-cli-vite/prefetch-feature
    preFetch: true, // Crucial for SSR data injection


    // app boot file (/src/boot)
    // --> boot files are part of "main.js"
    // https://v2.quasar.dev/quasar-cli-vite/boot-files
    boot: [
      'unocss',
      'axios',
      'theme',
      'updater',
      'desktopSessionKeepalive',
      ...(isMobileTarget ? ['mobileRuntime', 'androidBack'] : []),
    ],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#css
    css: ['app.scss'],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      // 'ionicons-v4',
      'mdi-v7',
      'fontawesome-v6', // include Font Awesome v6 (brands) for the discord icon
      // 'eva-icons',
      // 'themify',
      // 'line-awesome',
      // 'roboto-font-latin-ext', // this or either 'roboto-font', NEVER both!

      'roboto-font', // optional, you are not bound to it
      'material-icons', // optional, you are not bound to it
      'material-symbols-outlined', // nav icon set (sym_o_*)
    ],

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#build
    htmlVariables: { clientThemes: CLIENT_THEMES_DEFINE },
    build: {
      // Quasar v3 passes encoded import.meta.env keys, not bare dotenv keys.
      // Apply the same exact public allowlist to client AND SSR code.
      env: {
        clientPrefix: 'VITE_',
        backendPrefix: 'VITE_',
        filter: (env) => Object.fromEntries(Object.entries(env).filter(([key]) => [
          'VITE_API_BASE', 'VITE_WS_BASE', 'VITE_VAULT_WS_BASE', 'VITE_CAP_API_ENDPOINT',
          'VITE_DISCORD_RPC_CLIENT_ID', 'VITE_KLIPY_API_KEY', 'VITE_CLIENT_THEMES',
        ].some((name) => key === `import.meta.env.${name}`)).map(([key, value]) =>
          // Decode quoted strings only: parsing numeric lexemes loses ID precision.
          [key, JSON.stringify(value.startsWith('"') ? JSON.parse(value) : value)])),
        ...(process.env.MOURN_ISOLATED_BUILD === '1'
          ? { folder: resolve(projectRoot, 'scripts/isolated-env'), file: [] }
          : {}),
      },
      target: {
        browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
        node: 'node22',
      },

      typescript: {
        strict: true,
        vueShim: true,
        // extendTsConfig (tsConfig) {}
      },

      // Native shells (Tauri + Capacitor) load the bundle from a local asset
      // server that has no SPA rewrite rule, so a reload/deep link on a
      // path-based route 404s. Hash routing is what the desktop already ships
      // with; mobile inherits the same proven mode.
      vueRouterMode: isNativeTarget ? 'hash' : 'history',
      // vueRouterBase,
      // vueDevtools,
      // vueOptionsAPI: false,

      // rebuildCache: true, // rebuilds Vite/linter/etc cache on startup

      publicPath: '/',
      // analyze: true,
      vueOptionsAPI: true, // vue-advanced-cropper and existing Options API consumers
      defineEnv: {
        APP_VERSION: packageJson.version || '0.0.0',
        MOURN_TARGET: mournTarget,
        MOURN_ENABLE_UPDATER: process.env.MOURN_ENABLE_UPDATER || 'false',
      },
      define: {
        __MOURN_DESKTOP_BUILD__: isDesktopTarget ? 'true' : 'false',
        __MOURN_MOBILE_BUILD__: isMobileTarget ? 'true' : 'false',
        __MOURN_NATIVE_BUILD__: isNativeTarget ? 'true' : 'false',
        __MOURN_TARGET__: JSON.stringify(mournTarget),
        // Isolated releases disable Vite env-file loading; retain this public
        // opt-in flag for import.meta.env consumers without exposing other env.
        ...(process.env.MOURN_ISOLATED_BUILD === '1' ? {
          'import.meta.env.VITE_CLIENT_THEMES': JSON.stringify(CLIENT_THEMES_DEFINE),
        } : {}),
      },
      // ignorePublicFolder: true,
      // minify: false,
      // polyfillModulePreload: true,
      // distDir
      viteVuePluginOptions: widgetCompilerOptions,

      extendViteConf(viteConf) {
        // Quasar's filtered definitions are the only public env injection path.
        // envDir:false alone still lets Vite import prefixed process variables.
        viteConf.envPrefix = [];
        if (process.env.MOURN_ISOLATED_BUILD === '1') viteConf.envDir = false;
        if (ctx.prod) {
          viteConf.build ??= {};
          viteConf.build.rolldownOptions ??= {};
          const previous = viteConf.build.rolldownOptions.treeshake;
          viteConf.build.rolldownOptions.treeshake = {
            ...(typeof previous === 'object' ? previous : {}),
            manualPureFunctions: ['console.log', 'console.debug'],
          };
        }
        viteConf.server = viteConf.server ?? {};
        viteConf.server.watch = {
          ...(viteConf.server.watch ?? {}),
          ignored: ['**/src-tauri/target/**', '**/src-capacitor/**'],
        };

        viteConf.resolve = viteConf.resolve ?? {};
        const existingAliases = (
          Array.isArray(viteConf.resolve.alias)
            ? viteConf.resolve.alias
            : Object.entries(viteConf.resolve.alias ?? {}).map(([find, replacement]) => ({
                find,
                replacement,
              }))
        ).filter(
          (alias) =>
            alias.find !== 'crypto' &&
            String(alias.find) !== '/^crypto$/' &&
            alias.replacement !== resolve(srcRoot, 'crypto'),
        );

        // The Vault (E2EE messaging) is a NATIVE-shell feature, not a desktop
        // feature: web gets the no-op `vault.web.ts`, desktop AND mobile get the
        // real store. Keep this condition on isNativeTarget — swapping it to
        // isDesktopTarget silently strips messaging out of the mobile build.
        // FingerprintJS is a web/desktop implementation detail. Mobile resolves
        // the stable internal service to a no-fingerprint implementation so the
        // package is excluded from the Capacitor module graph entirely.
        const clientFingerprintAliases = isMobileTarget
          ? [
              {
                find: /^src\/services\/clientFingerprint$/,
                replacement: resolve(projectRoot, 'src/services/clientFingerprint.mobile.ts'),
              },
            ]
          : [];

        const vaultAliases = isNativeTarget
          ? []
          : [
              {
                find: /^src\/stores\/vault$/,
                replacement: resolve(projectRoot, 'src/stores/vault.web.ts'),
              },
              {
                find: /^stores\/vault$/,
                replacement: resolve(projectRoot, 'src/stores/vault.web.ts'),
              },
            ];

        const sharedAliases = [
          { find: 'assets', replacement: resolve(srcRoot, 'assets') },
          { find: 'utils', replacement: resolve(srcRoot, 'utils') },
          { find: 'composables', replacement: resolve(srcRoot, 'composables') },
          { find: 'services', replacement: resolve(srcRoot, 'services') },
          {
            find: 'src',
            replacement: srcRoot,
          },
          {
            find: 'boot',
            replacement: resolve(srcRoot, 'boot'),
          },
          {
            find: 'stores',
            replacement: resolve(srcRoot, 'stores'),
          },
          {
            find: 'components',
            replacement: resolve(srcRoot, 'components'),
          },
          {
            find: 'layouts',
            replacement: resolve(srcRoot, 'layouts'),
          },
          {
            find: 'pages',
            replacement: resolve(srcRoot, 'pages'),
          },
          {
            find: 'types',
            replacement: resolve(srcRoot, 'types'),
          },
          {
            find: 'utils',
            replacement: resolve(srcRoot, 'utils'),
          },
          {
            find: 'composables',
            replacement: resolve(srcRoot, 'composables'),
          },
          {
            find: 'services',
            replacement: resolve(srcRoot, 'services'),
          },
        ];

        viteConf.resolve.alias = [
          {
            find: /^crypto$/,
            replacement: resolve(srcRoot, 'utils/webcryptoShim.ts'),
          },
          ...clientFingerprintAliases,
          ...vaultAliases,
          ...sharedAliases,
          ...existingAliases,
        ];

        // @hpke/* (pulled in via ts-mls) dynamically imports the Node builtin
        // "crypto" as a Node-only fallback. Quasar also generates an alias for
        // the local src/crypto directory; the exact bare alias is removed above
        // so the dependency cannot be redirected into that directory.
        //
        // The whole @hpke/* family must ALSO stay out of the dep optimizer:
        // esbuild resolves their UMD/CJS-flavored entries to an empty module
        // (module.exports = {}), so ts-mls's makeAead/makeDhKem dynamic imports
        // fail at runtime with "Optional dependency '@hpke/chacha20poly1305' is
        // not installed" (the real error is swallowed by a catch). Excluding
        // them keeps those imports as bare specifiers served from the real ESM
        // files, exactly like @hpke/ml-kem below.
        viteConf.optimizeDeps = viteConf.optimizeDeps ?? {};
        const existingExclude = Array.isArray(viteConf.optimizeDeps.exclude)
          ? viteConf.optimizeDeps.exclude
          : [];
        viteConf.optimizeDeps.exclude = [
          ...new Set([
            ...existingExclude,
            '@hpke/core',
            '@hpke/common',
            '@hpke/chacha20poly1305',
            '@hpke/dhkem-x448',
            '@hpke/hybridkem-x-wing',
            '@hpke/ml-kem',
          ]),
        ];

        // ts-mls is reached only through the lazily-loaded messaging chunk, so
        // the dev server used to discover it AFTER the first scan, re-optimize
        // deps mid-session and answer the in-flight module request with
        // `504 (Outdated Optimize Dep)` — which surfaces as "Importing a module
        // script failed" and takes the router down with it. Naming it here puts
        // it in the initial optimization pass, so the hash never changes under a
        // running page.
        const existingInclude = Array.isArray(viteConf.optimizeDeps.include)
          ? viteConf.optimizeDeps.include
          : [];
        viteConf.optimizeDeps.include = [...new Set([...existingInclude, 'ts-mls'])];
      },
      // viteVuePluginOptions: {},

      vitePlugins: [
        ['unocss/vite', {}],
        [
          'vite-plugin-checker',
          {
            // Release scripts/CI run typecheck and lint as bounded standalone
            // checks. Do not duplicate their workers inside the Vite build.
            enableBuild: false,
            vueTsc: true,
            eslint: {
              lintCommand: 'eslint -c ./eslint.config.js "./src*/**/*.{ts,js,mjs,cjs,vue}"',
              useFlatConfig: true,
            },
          },
          { server: false },
        ],
      ],
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#devserver
    devServer: {
      port: 9001,
      open: false, // Prevent opening the browser automatically
      proxy: {
        // When Quasar sees '/api', it will forward it to your backend
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#framework
    framework: {
      // iconSet: 'material-icons', // Quasar icon set
      // lang: 'en-US', // Quasar language pack

      // For special cases outside of where the auto-import strategy can have an impact
      // (like functional components as one of the examples),
      // you can manually specify Quasar components/directives to be available everywhere:
      //
      // components: [],
      // directives: [],

      // Quasar brand palette — keep all Quasar utilities aligned with the app theme.
      config: {
        brand: {
          primary: '#ff0000',
          secondary: '#bdbdbd',
          accent: '#f85149',
          dark: '#000000',
          positive: '#21ba45',
          negative: '#f85149',
          info: '#f78166',
          warning: '#ffaa00',
        },
      },
      plugins: ['Meta', 'Notify', 'Dialog'],
    },

    // animations: 'all', // --- includes all animations
    // https://v2.quasar.dev/options/animations
    animations: [],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#sourcefiles
    // sourceFiles: {
    //   rootComponent: 'src/App.vue',
    //   router: 'src/router/index',
    //   store: 'src/store/index',
    //   pwaRegisterServiceWorker: 'src-pwa/register-service-worker',
    //   pwaServiceWorker: 'src-pwa/custom-service-worker',
    //   pwaManifestFile: 'src-pwa/manifest.json',
    //   electronMain: 'src-electron/electron-main',
    //   electronPreload: 'src-electron/electron-preload'
    //   bexManifestFile: 'src-bex/manifest.json
    // },

    // https://v2.quasar.dev/quasar-cli-vite/developing-ssr/configuring-ssr
    ssr: {
      prodPort: 3001, // The default port that the production server should use
      // (gets superseded if process.env.PORT is specified at runtime)

      middlewares: [
        'render', // keep this as last one
      ],

      // extendPackageJson (json) {},
      // extendSSRWebserverConf (esbuildConf) {},

      // manualStoreSerialization: true,
      // manualStoreSsrContextInjection: true,
      // manualStoreHydration: true,
      // manualPostHydrationTrigger: true,

      pwa: false,
      // pwaOfflineHtmlFilename: 'offline.html', // do NOT use index.html as name!

      // pwaExtendGenerateSWOptions (cfg) {},
      // pwaExtendInjectManifestOptions (cfg) {}
    },

    // https://v2.quasar.dev/quasar-cli-vite/developing-pwa/configuring-pwa
    pwa: {
      workboxMode: 'GenerateSW', // 'GenerateSW' or 'InjectManifest'
      // swFilename: 'sw.js',
      // manifestFilename: 'manifest.json',
      // extendManifestJson (json) {},
      // useCredentialsForManifestTag: true,
      // injectPwaMetaTags: false,
      // extendPWACustomSWConf (esbuildConf) {},
      // extendGenerateSWOptions (cfg) {},
      // extendInjectManifestOptions (cfg) {}
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-cordova-apps/configuring-cordova
    cordova: {
      // noIosLegacyBuildFlag: true, // uncomment only if you know what you are doing
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-capacitor-apps/configuring-capacitor
    capacitor: {
      hideSplashscreen: true,
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/configuring-electron
    electron: {
      // extendElectronMainConf (esbuildConf) {},
      // extendElectronPreloadConf (esbuildConf) {},

      // extendPackageJson (json) {},

      // Electron preload scripts (if any) from /src-electron, WITHOUT file extension
      preloadScripts: ['electron-preload'],

      // specify the debugging port to use for the Electron app when running in development mode
      inspectPort: 5858,

      bundler: 'packager', // 'packager' or 'builder'

      packager: {
        // https://github.com/electron-userland/electron-packager/blob/master/docs/api.md#options
        // OS X / Mac App Store
        // appBundleId: '',
        // appCategoryType: '',
        // osxSign: '',
        // protocol: 'myapp://path',
        // Windows only
        // win32metadata: { ... }
      },

      builder: {
        // https://www.electron.build/configuration/configuration

        appId: 'mourn-frontend',
      },
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-browser-extensions/configuring-bex
    bex: {
      // extendBexScriptsConf (esbuildConf) {},
      // extendBexManifestJson (json) {},

      /**
       * The list of extra scripts (js/ts) not in your bex manifest that you want to
       * compile and use in your browser extension. Maybe dynamic use them?
       *
       * Each entry in the list should be a relative filename to /src-bex/
       *
       * @example [ 'my-script.ts', 'sub-folder/my-other-script.js' ]
       */
      extraScripts: [],
    },
  };
});
