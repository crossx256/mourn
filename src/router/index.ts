import { defineRouter } from '#q-app';
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';
import routes from './routes';
import { useAuthStore } from 'src/stores/auth';
import { isNativeShellActive } from 'src/utils/platform';

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

/**
 * Upper bound on the one-off session check in the guard.
 *
 * Deliberately short: this runs BEFORE the first navigation resolves, so however
 * long it waits is time the app spends rendering nothing but a black page. A slow
 * network used to make that the whole boot (requests had no timeout at all). Two
 * seconds is enough for a healthy round trip; anything slower resolves in the
 * background and the guard proceeds from the known state.
 */
const SESSION_CHECK_TIMEOUT_MS = 2000;

export default defineRouter(function (/* { store, ssrContext } */) {
  const createHistory = import.meta.env.QUASAR_SERVER
    ? createMemoryHistory
    : import.meta.env.QUASAR_VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE),
  });

  // Track whether we've checked the session on initial load
  let sessionChecked = false;

  // Navigation guard for protected routes
  Router.beforeEach(async (to, _from, next) => {
    const authStore = useAuthStore();

    // The Vault/messaging surface exists only inside a native shell (Tauri
    // desktop or Capacitor mobile) — the website must never reach it.
    const isNativeShell = isNativeShellActive();
    if (to.name === 'chains' && !isNativeShell) {
      next({ path: '/desktop-only' });
      return;
    }

    // Only check session once on initial app load (client-side only)
    // Use typeof window check - more reliable than import.meta.env.QUASAR_SERVER in built code
    if (!sessionChecked && typeof window !== 'undefined') {
      // Native: attempt silent auto-login from the OS secret store first
      // (no-op on web). Bounded as well — it is a local bridge call, but a stalled
      // bridge must not be able to hold the first paint hostage.
      if (isNativeShell) {
        await Promise.race([
          authStore.autoLogin(),
          new Promise<void>((resolve) => {
            setTimeout(resolve, 1500);
          }),
        ]);
      }
      // Establish/refresh the auth state for the guard decision below.
      if (!authStore.isLoggedIn) {
        // Bounded: navigation must never be able to hang behind this. checkSession
        // has its own request timeout, but a second bound here means the app always
        // renders something (its offline/login state) even if the whole session
        // refresh stalls — otherwise router-view renders nothing at all, which is
        // the black screen when the app is reopened on a bad network.
        await Promise.race([
          authStore.checkSession(),
          new Promise<void>((resolve) => {
            setTimeout(resolve, SESSION_CHECK_TIMEOUT_MS);
          }),
        ]);
      }
      sessionChecked = true;
    }

    if (to.meta.requiresAuth && !authStore.isLoggedIn) {
      // Redirect to login with return URL
      next({
        path: '/login',
        query: { redirect: to.fullPath },
      });
    } else {
      next();
    }
  });

  return Router;
});
