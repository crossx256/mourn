/* External blocking script: no inline-script CSP exception required. */
(function () {
  'use strict';
  var script = document.currentScript;
  var enabled = script && script.dataset.enabled === 'true';
  var tray = location.pathname.endsWith('/tray-menu.html');
  var presets = {
    crimson: {},
    void: {
      bg: '#000000',
      surface: '#0b0b0b',
      card: '#111111',
      elevated: '#171717',
      hover: '#202020',
      border: '#282828',
      borderStrong: '#3b3b3b',
      text: '#ededed',
      textMuted: '#999999',
      textDim: '#757575',
      accent: '#cccccc',
    },
    phosphor: {
      bg: '#000400',
      surface: '#061006',
      card: '#0a160a',
      elevated: '#0e1c0e',
      hover: '#142614',
      border: '#1d331d',
      borderStrong: '#315031',
      text: '#e0f4e0',
      textMuted: '#8eab8e',
      textDim: '#6c896c',
      accent: '#00ff00',
    },
    ice: {
      bg: '#000407',
      surface: '#061015',
      card: '#0a171e',
      elevated: '#0e1e26',
      hover: '#142a33',
      border: '#1d3540',
      borderStrong: '#315362',
      text: '#e0f2fa',
      textMuted: '#8ea9b7',
      textDim: '#6c8795',
      accent: '#00ffff',
    },
    violet: {
      bg: '#050208',
      surface: '#100a18',
      card: '#181020',
      elevated: '#20162a',
      hover: '#2b1e38',
      border: '#39294a',
      borderStrong: '#543e6b',
      text: '#f0e8fa',
      textMuted: '#aa98bd',
      textDim: '#88769b',
      accent: '#bb88ff',
    },
  };

  var defaults = {
    bg: '#000000',
    surface: '#0d0d0d',
    card: '#101010',
    elevated: '#0a0a0a',
    hover: '#1a1a1a',
    border: '#1a1a1a',
    borderStrong: '#2a2a2a',
    text: '#eeeeee',
    textMuted: '#888888',
    textDim: '#666666',
    textFaint: '#555555',
    accent: '#ff0000',
    accentStrong: '#cc0000',
    accentAlt: '#f85149',
    accentAlt2: '#f78166',
    onAccent: '#000000',
    success: '#00ff00',
    warning: '#ffaa00',
    danger: '#f85149',
    info: '#f78166',
    arcBg: '#050505',
    arcSurface: '#0a0a0a',
    arcCard: '#0d0d0d',
    arcText: '#e0e0e0',
    arcMuted: '#777777',
    arcDim: '#555555',
    arcAccent: '#c0c0c0',
    arcEncrypted: '#ff3333',
    arcRed: '#e32626',
    arcMutedWarm: '#9c9791',
    lbRed: '#ff0000',
    lbMuted: '#888888',
  };
  var root = document.documentElement;
  var patterns = [
    'none',
    'dots',
    'synapse',
    'rain',
    'constellations',
    'perlin-flow',
    'petals',
    'sparkles',
    'embers',
  ];
  function closed(value, keys) {
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every(function (key) {
        return keys.includes(key);
      })
    );
  }
  function validHex(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
  }
  function luminance(hex) {
    return [1, 3, 5].reduce(function (sum, offset, index) {
      var channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      var linear = channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      return sum + linear * [0.2126, 0.7152, 0.0722][index];
    }, 0);
  }
  function validLook(value) {
    if (typeof value.preset !== 'string' || !Object.hasOwn(presets, value.preset)) return false;
    if (value.accent === null) return true;
    if (!validHex(value.accent)) return false;
    var accent = luminance(value.accent);
    var background = luminance(presets[value.preset].bg || defaults.bg);
    return (Math.max(accent, background) + 0.05) / (Math.min(accent, background) + 0.05) >= 3;
  }
  function validFx(fx) {
    return (
      closed(fx, ['pattern', 'color', 'intensity', 'size']) &&
      patterns.includes(fx.pattern) &&
      (fx.color === null || validHex(fx.color)) &&
      typeof fx.intensity === 'number' &&
      Number.isFinite(fx.intensity) &&
      fx.intensity >= 0 &&
      fx.intensity <= 1 &&
      typeof fx.size === 'number' &&
      Number.isFinite(fx.size) &&
      fx.size >= 0.5 &&
      fx.size <= 2
    );
  }
  function syncFrostedBody() {
    if (document.body)
      document.body.classList.toggle('theme-frosted', root.dataset.frosted === 'on');
  }
  function apply() {
    try {
      var path = location.hash ? location.hash.slice(1).split('?')[0] : location.pathname;
      var known = [
        '',
        'login',
        'forgot-password',
        'reset-password',
        'verify-email',
        'register',
        'dashboard',
        'graveyard',
        'help',
        'tickets',
        'terms',
        'contact',
        'patch-notes',
        'about',
        'payment',
        'leaderboard',
        'download',
        'desktop-only',
        'archives',
        'chains',
      ];
      if (!tray && !known.includes(path.split('/')[1] || '')) return;
      if (!enabled && !(tray && localStorage.getItem('mourn_theme_enabled') === 'true')) return;
      var raw = localStorage.getItem('mourn_theme_last');
      if (!raw || raw.length > 12000) return;
      var cache = JSON.parse(raw),
        p = cache.prefs,
        legacyKeys = ['v', 'preset', 'accent', 'density', 'scale', 'extras', 'saved', 'updatedAt'],
        extensionKeys = ['fx', 'frosted', 'font'],
        extendedKeys = legacyKeys.concat(extensionKeys);
      if (
        cache.v !== 1 ||
        typeof cache.userId !== 'string' ||
        !closed(p, extendedKeys) ||
        new TextEncoder().encode(JSON.stringify(p)).length > 8192 ||
        p.v !== 1 ||
        !validLook(p) ||
        !['compact', 'comfortable', 'spacious'].includes(p.density)
      )
        return;
      var extensionCount = extensionKeys.filter(function (key) {
        return Object.hasOwn(p, key);
      }).length;
      if (
        (extensionCount !== 0 && extensionCount !== extensionKeys.length) ||
        ![0.9, 1, 1.1, 1.25].includes(p.scale) ||
        !closed(p.extras, ['chatTextSize', 'chatDensity', 'reduceMotion']) ||
        !['sm', 'md', 'lg'].includes(p.extras.chatTextSize) ||
        !['compact', 'comfortable'].includes(p.extras.chatDensity) ||
        typeof p.extras.reduceMotion !== 'boolean' ||
        !Array.isArray(p.saved) ||
        p.saved.length > 5 ||
        new Set(
          p.saved.map(function (saved) {
            return saved && saved.id;
          }),
        ).size !== p.saved.length ||
        !p.saved.every(function (saved) {
          return (
            closed(saved, ['id', 'name', 'preset', 'accent', 'density', 'fx', 'frosted', 'font']) &&
            (!Object.hasOwn(saved, 'fx') || validFx(saved.fx)) &&
            (!Object.hasOwn(saved, 'frosted') || typeof saved.frosted === 'boolean') &&
            (!Object.hasOwn(saved, 'font') || ['mono', 'opendyslexic'].includes(saved.font)) &&
            validLook(saved) &&
            typeof saved.id === 'string' &&
            /^[a-zA-Z0-9_-]{1,64}$/.test(saved.id) &&
            typeof saved.name === 'string' &&
            !!saved.name.trim() &&
            saved.name.length <= 60 &&
            !Array.from(saved.name).some(function (character) {
              var code = character.charCodeAt(0);
              return code < 32 || code === 127 || character === '<' || character === '>';
            }) &&
            (saved.density === undefined ||
              ['compact', 'comfortable', 'spacious'].includes(saved.density))
          );
        }) ||
        !(
          p.updatedAt === null ||
          (typeof p.updatedAt === 'string' &&
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.updatedAt) &&
            Number.isFinite(Date.parse(p.updatedAt)))
        )
      )
        return;
      var fx =
          extensionCount === 0 ? { pattern: 'none', color: null, intensity: 0.5, size: 1 } : p.fx,
        frosted = p.frosted === undefined ? false : p.frosted,
        font = p.font === undefined ? 'mono' : p.font;
      if (
        !closed(fx, ['pattern', 'color', 'intensity', 'size']) ||
        !patterns.includes(fx.pattern) ||
        !(fx.color === null || validHex(fx.color)) ||
        typeof fx.intensity !== 'number' ||
        !Number.isFinite(fx.intensity) ||
        fx.intensity < 0 ||
        fx.intensity > 1 ||
        typeof fx.size !== 'number' ||
        !Number.isFinite(fx.size) ||
        fx.size < 0.5 ||
        fx.size > 2 ||
        typeof frosted !== 'boolean' ||
        !['mono', 'opendyslexic'].includes(font)
      )
        return;
      var colors = Object.assign({}, defaults, presets[p.preset]),
        accent = p.accent || colors.accent;
      colors.accent = accent;
      if (p.preset !== 'crimson' || p.accent) {
        colors.accentAlt = colors.accentAlt2 = accent;
        colors.accentStrong =
          '#' +
          [1, 3, 5]
            .map(function (i) {
              return Math.round(parseInt(accent.slice(i, i + 2), 16) * 0.9)
                .toString(16)
                .padStart(2, '0');
            })
            .join('');
      }
      var lum = [1, 3, 5]
        .map(function (i) {
          var n = parseInt(accent.slice(i, i + 2), 16) / 255;
          return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
        })
        .reduce(function (sum, n, i) {
          return sum + n * [0.2126, 0.7152, 0.0722][i];
        }, 0);
      colors.onAccent = lum > 0.179 ? '#000000' : '#ffffff';
      // Keep in sync with ACCENT_FOLLOWERS in src/theme/apply.ts. The leaderboard's
      // brand red must track the accent before hydration, or the page flashes
      // the un-themed crimson until the store applies the theme.
      colors.lbRed = accent;
      function tint(amount) {
        return (
          '#' +
          [1, 3, 5]
            .map(function (i) {
              return Math.round(
                parseInt(colors.surface.slice(i, i + 2), 16) * (1 - amount) +
                  parseInt(accent.slice(i, i + 2), 16) * amount,
              )
                .toString(16)
                .padStart(2, '0');
            })
            .join('')
        );
      }
      function onColor(hex) {
        var value = [1, 3, 5]
          .map(function (i) {
            var n = parseInt(hex.slice(i, i + 2), 16) / 255;
            return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
          })
          .reduce(function (sum, n, i) {
            return sum + n * [0.2126, 0.7152, 0.0722][i];
          }, 0);
        return value > 0.179 ? '#000000' : '#ffffff';
      }
      colors.inputBg = tint(0.06);
      colors.inputText = onColor(colors.inputBg);
      colors.bubbleBg = tint(0.12);
      colors.bubbleText = onColor(colors.bubbleBg);
      colors.sendBg = accent;
      colors.sendText = colors.onAccent;
      Object.keys(colors).forEach(function (key) {
        var hex = colors[key];
        if (!/^#[a-f0-9]{6}$/i.test(hex)) return;
        root.style.setProperty(
          '--m-' + key + '-rgb',
          [1, 3, 5]
            .map(function (i) {
              return parseInt(hex.slice(i, i + 2), 16);
            })
            .join(' '),
        );
      });
      var rgb = [1, 3, 5].map(function (i) {
        return parseInt(accent.slice(i, i + 2), 16);
      });
      root.style.setProperty(
        '--m-accent-hover',
        'rgb(' +
          rgb
            .map(function (n) {
              return Math.round(n + (255 - n) * 0.12);
            })
            .join(' ') +
          ')',
      );
      root.style.setProperty(
        '--m-accent-active',
        'rgb(' +
          rgb
            .map(function (n) {
              return Math.round(n * 0.9);
            })
            .join(' ') +
          ')',
      );
      root.style.setProperty('--m-focus-ring', 'rgb(' + rgb.join(' ') + ' / .35)');
      root.dataset.clientTheme = 'on';
      root.dataset.theme = p.preset;
      if (p.accent) root.dataset.themeAccent = p.accent;
      else delete root.dataset.themeAccent;
      root.dataset.density = p.density;
      root.dataset.chatSize = p.extras.chatTextSize;
      root.dataset.chatDensity = p.extras.chatDensity;
      var density = { compact: [4, 32, 12], comfortable: [8, 40, 13], spacious: [12, 48, 14] }[
        p.density
      ];
      ['space-unit', 'row-h', 'font-step'].forEach(function (key, i) {
        root.style.setProperty('--m-' + key, density[i] + 'px');
      });
      root.dataset.font = font;
      if (
        frosted &&
        !/^\/(login|forgot-password|reset-password|verify-email|register)(\/|$)/.test(path)
      )
        root.dataset.frosted = 'on';
      else delete root.dataset.frosted;
      syncFrostedBody();
    } catch {
      /* Corrupt or unavailable storage falls back to CSS. */
    }
  }
  apply();
  if (!document.body)
    document.addEventListener?.('DOMContentLoaded', syncFrostedBody, { once: true });
  if (tray)
    window.addEventListener('storage', function (e) {
      if (e.key === null || e.key === 'mourn_theme_last' || e.key === 'mourn_theme_enabled') {
        Object.keys(defaults).forEach(function (key) {
          root.style.removeProperty('--m-' + key + '-rgb');
        });
        ['inputBg', 'inputText', 'bubbleBg', 'bubbleText', 'sendBg', 'sendText'].forEach(
          function (key) {
            root.style.removeProperty('--m-' + key + '-rgb');
          },
        );
        [
          '--m-accent-hover',
          '--m-accent-active',
          '--m-focus-ring',
          '--m-space-unit',
          '--m-row-h',
          '--m-font-step',
        ].forEach(function (key) {
          root.style.removeProperty(key);
        });
        [
          'clientTheme',
          'theme',
          'themeAccent',
          'density',
          'chatSize',
          'chatDensity',
          'font',
          'frosted',
        ].forEach(function (key) {
          delete root.dataset[key];
        });
        syncFrostedBody();
        apply();
      }
    });
})();
