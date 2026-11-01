import { onMounted, watch, type Ref } from 'vue';

/**
 * Composable: useProfileGlitch
 *
 * Implements the legacy baffle.js glitch effect for profile entrance animation.
 * Matches the exact behavior from legacy EJS profile-effects.js:
 * - Loads baffle.js conditionally when profileAnimation === 'glitch'
 * - Applies glitch effect to username, handle, bio, stat values, and stat labels
 * - Uses same glitch characters and timing as legacy
 */

declare global {
  interface Window {
    baffle?: (element: HTMLElement) => {
      set: (options: { characters: string; speed: number }) => void;
      start: () => void;
      reveal: (duration: number) => void;
    };
  }
}

export function useProfileGlitch(enabled: Ref<boolean> | (() => boolean)) {
  // SSR GUARD — baffle.js and DOM queries are client-only
  if (import.meta.env.QUASAR_SERVER) return;

  let baffleLoaded = false;

  function loadBaffle(): Promise<void> {
    if (baffleLoaded || typeof window === 'undefined') {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (window.baffle) {
        baffleLoaded = true;
        resolve();
        return;
      }

      // Load baffle.js from CDN (same as legacy)
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/baffle@0.3.6/dist/baffle.min.js';
      script.async = true;
      script.onload = () => {
        baffleLoaded = true;
        resolve();
      };
      script.onerror = () => {
        reject(new Error('Failed to load baffle.js'));
      };
      document.head.appendChild(script);
    });
  }

  function applyGlitch() {
    if (typeof window === 'undefined') return;
    const baffle = window.baffle;
    if (!baffle) return;

    const glitchChars = '█▓█ ▒░/▒░ █░▒▓/ █▒▒ ▓▒▓/█ ░█▒/ ▒▓░ █<░▒ ▓/░>';

    // Apply to username
    const username = document.querySelector('.profile-username');
    if (username) {
      const usernameText = baffle(username as HTMLElement);
      usernameText.set({ characters: glitchChars, speed: 120 });
      usernameText.start();
      usernameText.reveal(2000);
    }

    // Apply to handle
    const handle = document.querySelector('.profile-handle');
    if (handle) {
      const handleText = baffle(handle as HTMLElement);
      handleText.set({ characters: glitchChars, speed: 120 });
      handleText.start();
      handleText.reveal(2000);
    }

    // Apply to bio
    const bio = document.querySelector('.profile-bio');
    if (bio) {
      const bioText = baffle(bio as HTMLElement);
      bioText.set({ characters: glitchChars, speed: 120 });
      bioText.start();
      bioText.reveal(2000);
    }

    // Apply to stat values
    const statValues = document.querySelectorAll('.stat-value');
    statValues.forEach((stat) => {
      const statText = baffle(stat as HTMLElement);
      statText.set({ characters: glitchChars, speed: 120 });
      statText.start();
      statText.reveal(2000);
    });

    // Apply to stat labels
    const statLabels = document.querySelectorAll('.stat-label');
    statLabels.forEach((stat) => {
      const statText = baffle(stat as HTMLElement);
      statText.set({ characters: glitchChars, speed: 120 });
      statText.start();
      statText.reveal(2000);
    });
  }

  function initGlitch() {
    // SSR GUARD: strict check
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const isEnabled = typeof enabled === 'function' ? enabled() : enabled.value;
    if (!isEnabled) return;

    loadBaffle()
      .then(() => {
        // Delay to ensure DOM is ready (matches legacy setTimeout 100ms)
        setTimeout(() => {
          applyGlitch();
        }, 100);
      })
      .catch((err) => {
        console.warn('Profile glitch effect failed to load:', err);
      });
  }

  onMounted(() => {
    // Only verify/run on client mount
    initGlitch();

    // Watch for changes ONLY after mount
    watch(
      () => (typeof enabled === 'function' ? enabled() : enabled.value),
      (newVal) => {
        if (newVal) {
          initGlitch();
        }
      },
    );
  });
}
