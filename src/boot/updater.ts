import { defineBoot } from '#q-app';
import { Dialog, Notify } from 'quasar';

/**
 * Mourn desktop auto-updater.
 *
 * Design goals (krul, v1.3.4):
 *  - SEAMLESS: the update installs in the background, with a small progress bar
 *    pinned bottom-right. The user is only asked a question when it is actually
 *    needed: "restart now / restart later".
 *  - TRUTHFUL: never claim an update is available unless the advertised version
 *    is genuinely NEWER than the running build. The old preflight only checked
 *    that the JSON had version/url/signature, so it announced an update even
 *    when `check()` then reported "already up to date" — that mismatch is a
 *    large part of "it says there's an update and then nothing happens".
 *  - FAIL LOUDLY: a failed update used to write a localStorage marker, show a
 *    4-second toast and then hide the whole thing for an hour.
 *  - PLATFORM HONEST: Tauri's Linux updater can only install into an AppImage
 *    (it replaces `$APPIMAGE`). On a .deb install the install step is
 *    guaranteed to fail, so we deliberately do not attempt it — we hand the
 *    user a clear, working alternative instead of a silent failure.
 */

const STARTUP_UPDATE_DELAY_MS = 3_000;
const FAILED_UPDATE_RETRY_AFTER_MS = 60 * 60 * 1000;
const UPDATE_ENDPOINT_ORIGIN = 'https://mourn.bio';
const CURRENT_APP_VERSION = import.meta.env.APP_VERSION || '0.0.0';
const DOWNLOAD_PAGE_URL = 'https://mourn.bio/download';

/** Bottom-right notification key so the progress bar is reused, not stacked. */
const PROGRESS_NOTIFY_GROUP = 'mourn-update-progress';

interface ReleasePayload {
  version: string;
  url: string;
  signature: string;
  notes?: string;
  pub_date?: string;
}

type PreflightResult =
  | { status: 'available'; release: ReleasePayload }
  | { status: 'current'; remoteVersion: string }
  | { status: 'disabled' }
  | { status: 'unknown'; reason: string };

function isDesktopTauri(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    navigator.userAgent.includes('Tauri')
  );
}

/**
 * Packaging probe result, cached because the preflight URL depends on it:
 * a `.deb` install must be served the `.deb` artifact, not the AppImage.
 */
let packagingInfo: { appImage: boolean; flatpak: boolean } | null = null;

function isLinuxHost(): boolean {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  return platform.includes('linux') || userAgent.includes('linux');
}

function resolveUpdaterTarget(): string {
  // On Linux the answer depends on how the app was packaged, not just the OS:
  //   `linux`     → the AppImage, which the native Tauri updater CAN install.
  //   `linux-deb` → a verified download for manual package-manager installation.
  // Asking for the wrong one is exactly how a .deb client ends up being handed
  // an AppImage it can never install.
  if (isLinuxHost() && packagingInfo && !packagingInfo.flatpak) {
    return packagingInfo.appImage ? 'linux' : 'linux-deb';
  }

  // These mirror the backend TARGET_CONFIG aliases so the preflight endpoint
  // resolves to the right platform.
  if (isLinuxHost()) {
    return 'linux';
  }

  return 'windows';
}

function updaterUrl(): string {
  return `${UPDATE_ENDPOINT_ORIGIN}/update/${resolveUpdaterTarget()}/${CURRENT_APP_VERSION}`;
}

/**
 * Compare dotted numeric versions. Returns >0 when `a` is newer than `b`.
 *
 * Deliberately tolerant: strips a leading `v`, ignores any pre-release/build
 * suffix, and treats a missing segment as 0, so `1.3.4` > `1.3.4-rc.1` > `1.3`.
 */
function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      ?.split('.')
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      }) ?? [];

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function shouldSkipRecentFailedUpdate(version: string): boolean {
  try {
    const raw = localStorage.getItem(`mourn:update-failed:${version}`);
    if (!raw) return false;

    const failedAt = Number.parseInt(raw, 10);
    return Number.isFinite(failedAt) && Date.now() - failedAt < FAILED_UPDATE_RETRY_AFTER_MS;
  } catch {
    return false;
  }
}

function markUpdateFailed(version: string): void {
  try {
    localStorage.setItem(`mourn:update-failed:${version}`, String(Date.now()));
  } catch {
    /* ignore storage failure */
  }
}

function clearUpdateFailure(version: string): void {
  try {
    localStorage.removeItem(`mourn:update-failed:${version}`);
  } catch {
    /* ignore storage failure */
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Ask the app how it is packaged. Returns false for both on Windows and on any
 * failure, which is the safe default: we would rather not attempt an install
 * than attempt one that cannot succeed.
 */
async function detectPackaging(): Promise<{ appImage: boolean; flatpak: boolean }> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const status = await invoke<{ isAppimage?: boolean; isFlatpak?: boolean }>('get_system_status');
    return { appImage: status?.isAppimage === true, flatpak: status?.isFlatpak === true };
  } catch {
    // Packaging detection is an update safety boundary, not a best-effort hint.
    throw new Error('Cannot determine application packaging; automatic update disabled');
  }
}

async function preflightUpdateEndpoint(): Promise<PreflightResult> {
  const url = updaterUrl();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
    });

    if (response.status === 204) {
      return { status: 'current', remoteVersion: CURRENT_APP_VERSION };
    }

    if (response.status === 404) {
      return {
        status: 'unknown',
        reason: `unsupported updater target (${resolveUpdaterTarget()})`,
      };
    }

    if (!response.ok) {
      return { status: 'unknown', reason: `updater endpoint returned HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return {
        status: 'unknown',
        reason: `updater endpoint returned ${contentType || 'unknown content type'} instead of JSON`,
      };
    }

    const body = (await response.json()) as Partial<ReleasePayload> | null;
    if (!body || typeof body.version !== 'string') {
      return { status: 'disabled' };
    }

    if (typeof body.url !== 'string' || typeof body.signature !== 'string') {
      return {
        status: 'unknown',
        reason: 'updater JSON is missing top-level url/signature fields',
      };
    }

    // THE fix for the false alarm: only report an update when the advertised
    // version is actually newer than what is running. The server can be (and
    // has been) stale — e.g. advertising 1.1.3 to a 1.3.3 client — which the
    // old code reported as "update available" before `check()` contradicted it.
    if (compareVersions(body.version, CURRENT_APP_VERSION) <= 0) {
      return { status: 'current', remoteVersion: body.version };
    }

    return {
      status: 'available',
      release: {
        version: body.version,
        url: body.url,
        signature: body.signature,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        pub_date: typeof body.pub_date === 'string' ? body.pub_date : undefined,
      },
    };
  } catch (error) {
    return { status: 'unknown', reason: errorMessage(error) };
  }
}
/**
 * Persistent bottom-right bar; returns an updater that replaces its message.
 *
 * Quasar's `Notify.progress` is BOOLEAN (an indeterminate bar) — it cannot be
 * driven with a number, so the percentage is carried in the message text.
 */
function createProgressBar(version: string): (update: { message: string }) => void {
  const notify = Notify.create({
    group: PROGRESS_NOTIFY_GROUP,
    position: 'bottom-right',
    timeout: 0,
    progress: true,
    color: 'dark',
    textColor: 'white',
    icon: 'system_update_alt',
    message: `Downloading mourn ${version}…`,
    caption: 'the update installs in the background — you can keep working',
  });
  return (update) => notify(update);
}

function finishProgressBar(version: string): void {
  Notify.create({
    group: PROGRESS_NOTIFY_GROUP,
    position: 'bottom-right',
    timeout: 800,
    progress: true,
    color: 'dark',
    textColor: 'white',
    icon: 'system_update_alt',
    message: `mourn ${version} ready`,
    caption: 'restart to finish',
  });
}

/** Ask the one question that matters, and only after the install succeeded. */
function promptRestart(version: string, relaunch: () => Promise<void>): void {
  Dialog.create({
    dark: true,
    title: `mourn ${version} is installed`,
    message: 'Restart now to finish the update, or keep working and restart later.',
    ok: { label: 'restart now', color: 'primary', noCaps: true },
    cancel: { label: 'restart later', color: 'grey-7', noCaps: true, flat: true },
    persistent: false,
  })
    .onOk(() => {
      void relaunch().catch((error) => {
        console.warn('[updater] relaunch after update failed', error);
      });
    })
    .onCancel(() => {
      Notify.create({
        position: 'bottom-right',
        timeout: 6000,
        color: 'dark',
        textColor: 'white',
        icon: 'restart_alt',
        message: `mourn ${version} will run after you next start the app`,
        caption: 'no action needed',
      });
    });
}

/**
 * A .deb/native install cannot be updated in place: Tauri's Linux updater only
 * supports AppImage, and replacing system packages needs root. Instead of
 * running an install that is guaranteed to fail (and then swallowing the
 * error), tell the user exactly where to get the new build.
 */
function notifyManualLinuxUpdate(release: ReleasePayload): void {
  Notify.create({
    position: 'bottom-right',
    timeout: 0,
    color: 'dark',
    textColor: 'white',
    icon: 'system_update_alt',
    message: `mourn ${release.version} is available`,
    caption: 'this install is managed by your package manager — open the download page?',
    actions: [
      {
        label: 'download',
        color: 'primary',
        noCaps: true,
        handler: () => {
          void import('@tauri-apps/plugin-opener')
            .then(({ openUrl }) => openUrl(DOWNLOAD_PAGE_URL))
            .catch(() => window.open(DOWNLOAD_PAGE_URL, '_blank'));
        },
      },
      { label: 'later', color: 'grey-7', noCaps: true, handler: () => undefined },
    ],
  });
}

export default defineBoot(() => {
  if (import.meta.env.QUASAR_SERVER || !isDesktopTauri()) {
    return;
  }

  // Dev builds do not register the updater plugin unless explicitly requested.
  // Production desktop builds always check automatically with no end-user env var.
  if (import.meta.env.QUASAR_DEV && import.meta.env.MOURN_ENABLE_UPDATER !== 'true') {
    return;
  }

  void (async () => {
    await delay(STARTUP_UPDATE_DELAY_MS);
    let attemptedVersion = 'unknown';

    try {
      // Probe packaging FIRST: it decides which target we ask the endpoint for
      // (`linux` = AppImage, `linux-deb` = .deb), so the preflight URL depends
      // on it. Asking for the wrong one is how a deb install would be handed an
      // AppImage it can never install.
      packagingInfo = await detectPackaging();

      // A Flatpak sandbox cannot write /app and `flatpak update` already handles
      // updates — stand down before making a request at all.
      if (packagingInfo.flatpak) {
        console.info('[updater] running as a Flatpak — deferring to `flatpak update`');
        return;
      }

      console.info('[updater] checking for updates', {
        currentVersion: CURRENT_APP_VERSION,
        target: resolveUpdaterTarget(),
      });

      const preflight = await preflightUpdateEndpoint();

      if (preflight.status === 'current') {
        console.info('[updater] already on the newest version', {
          currentVersion: CURRENT_APP_VERSION,
          advertisedVersion: preflight.remoteVersion,
        });
        return;
      }

      if (preflight.status === 'disabled') {
        console.info('[updater] update checks are disabled or no release metadata is available');
        return;
      }

      if (preflight.status === 'unknown') {
        console.warn('[updater] endpoint preflight failed', {
          reason: preflight.reason,
          url: updaterUrl(),
        });
      } else {
        console.info('[updater] update available', {
          currentVersion: CURRENT_APP_VERSION,
          latestVersion: preflight.release.version,
        });
        attemptedVersion = preflight.release.version;
      }

      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: 10_000 });

      // The plugin compares HTTPS version metadata here. The detached package
      // signature is verified during download/install; the manifest is not signed.
      if (!update) {
        console.info('[updater] plugin reports no applicable update', {
          currentVersion: CURRENT_APP_VERSION,
        });
        return;
      }

      attemptedVersion = update.version;

      if (shouldSkipRecentFailedUpdate(update.version)) {
        console.warn('[updater] skipping recently failed update retry', {
          version: update.version,
        });
        return;
      }

      const { relaunch } = await import('@tauri-apps/plugin-process');

      // ── Packaging decides the strategy, BEFORE anything is attempted ──────
      const target = resolveUpdaterTarget();

      if (target === 'linux' || target === 'linux-deb') {
        const packaging = await detectPackaging();

        // Flatpak: the sandbox cannot write /app, and `flatpak update` already
        // handles updates. Attempting an in-app update here would produce a
        // permanent "update failed" on every launch, so stand down silently.
        if (packaging.flatpak) {
          console.info('[updater] running as a Flatpak — deferring to `flatpak update`');
          return;
        }

        if (!packaging.appImage) {
          // Native packages are downloaded and verified, never installed by an
          // elevated subprocess. The user chooses their package manager.
          if (preflight.status !== 'available') {
            // Without url+signature from the endpoint we have nothing to verify,
            // so fall back to pointing the user at the download page.
            console.info('[updater] no verified artifact to install — offering download page');
            notifyManualLinuxUpdate({
              version: update.version,
              url: '',
              signature: '',
            });
            return;
          }

          console.info('[updater] preparing a verified .deb download');

          const { invoke } = await import('@tauri-apps/api/core');
          const debProgress = createProgressBar(update.version);
          debProgress({ message: `Downloading mourn ${update.version} (.deb)…` });

          const handoff = await invoke<{ status: string; path: string; instructions: string }>('prepare_linux_deb_update', {
            url: preflight.release.url,
            signature: preflight.release.signature,
          });

          if (handoff.status !== 'manual-install-required') throw new Error('Unexpected package handoff');
          clearUpdateFailure(update.version);
          finishProgressBar(update.version);
          Notify.create({
            type: 'info', timeout: 0, closeBtn: true,
            message: `mourn ${update.version} downloaded, not installed.`,
            caption: `${handoff.path} — ${handoff.instructions}`,
          });
          return;
        }
      }

      // ── Background download + install, with the bottom-right progress bar ──
      //
      // NOTE the event shape: `Started` carries `contentLength` (total), but
      // `Progress` carries only a per-chunk `chunkLength` delta — it is NOT
      // cumulative. Percentage therefore has to be accumulated here.
      const updateProgress = createProgressBar(update.version);
      let receivedBytes = 0;
      let totalBytes = 0;
      let lastPercent = -1;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            totalBytes = event.data.contentLength ?? 0;
            return;
          case 'Progress':
            receivedBytes += event.data.chunkLength;
            break;
          case 'Finished':
            updateProgress({ message: `Installing mourn ${update.version}…` });
            return;
        }

        if (totalBytes > 0) {
          const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
          // Rate-limit repaints: this callback fires once per chunk.
          if (percent !== lastPercent) {
            lastPercent = percent;
            updateProgress({ message: `Downloading mourn ${update.version}… ${percent}%` });
          }
        }
      });

      clearUpdateFailure(update.version);
      finishProgressBar(update.version);

      // The user decides when to restart — no surprise relaunch mid-task.
      promptRestart(update.version, relaunch);
    } catch (error) {
      markUpdateFailed(attemptedVersion);
      console.error('[updater] automatic update failed', {
        currentVersion: CURRENT_APP_VERSION,
        attemptedUpdateVersion: attemptedVersion,
        error,
      });
      // Surface it, with a way out. The old behaviour was a 4-second toast plus
      // an invisible one-hour lockout, which is why a failed update looked like
      // "nothing happened" and why the reason never reached us.
      const detail = errorMessage(error);
      Notify.create({
        position: 'bottom-right',
        timeout: 0,
        color: 'dark',
        textColor: 'white',
        icon: 'error_outline',
        message: `Update to ${attemptedVersion} failed`,
        caption: `${detail.slice(0, 140)} — retry, or it will be tried again later`,
        actions: [
          {
            label: 'retry',
            color: 'primary',
            noCaps: true,
            handler: () => {
              // Clear the failure marker first, otherwise the retry would be
              // skipped by the same lockout that hid the failure.
              clearUpdateFailure(attemptedVersion);
              window.location.reload();
            },
          },
          { label: 'dismiss', color: 'grey-7', noCaps: true, handler: () => undefined },
        ],
      });
    }
  })();
});
