import { defineConfig, presetUno } from 'unocss';

export default defineConfig({
  presets: [presetUno()],
  theme: {
    colors: {
      // Dashboard theme colors
      primary: 'rgb(var(--m-accent-rgb, 255 0 0))',
      'primary-dark': 'rgb(var(--m-legacyAccentDark-rgb, 65 1 1))',
      'primary-dim': 'rgb(var(--m-accent-rgb, 255 0 0) / 0.15)',
      accent: 'rgb(var(--m-accentAlt-rgb, 248 81 73))',
      'accent-secondary': 'rgb(var(--m-accentAlt2-rgb, 247 129 102))',
      // Backgrounds
      'dash-bg': 'rgb(var(--m-bg-rgb, 0 0 0))',
      'dash-sidebar': 'rgb(var(--m-elevated-rgb, 10 10 10))',
      'dash-panel': 'rgb(var(--m-surface-rgb, 13 13 13))',
      'dash-card': 'rgb(var(--m-card-rgb, 16 16 16))',
      // Borders
      'dash-border': 'rgb(var(--m-border-rgb, 26 26 26))',
      'dash-border-hover': 'rgb(var(--m-borderStrong-rgb, 42 42 42))',
      // Text
      'dash-text': 'rgb(var(--m-text-rgb, 238 238 238))',
      'dash-muted': 'rgb(var(--m-textMuted-rgb, 136 136 136))',
      // Status
      'dash-success': 'rgb(var(--m-success-rgb, 0 255 0))',
      'dash-warning': 'rgb(var(--m-warning-rgb, 255 170 0))',
      // Legacy aliases
      'bg-primary': 'rgb(var(--m-legacyBg-rgb, 13 17 23))',
      'text-primary': 'rgb(var(--m-accent-rgb, 255 0 0))',
      border: 'rgb(var(--m-legacyBorder-rgb, 48 54 61))',
      warning: 'rgb(var(--m-legacyWarning-rgb, 210 153 34))',
      danger: 'rgb(var(--m-danger-rgb, 248 81 73))',
      panel: 'rgb(var(--m-surface-rgb, 13 13 13))',
      card: 'rgb(var(--m-card-rgb, 16 16 16))',
      muted: 'rgb(var(--m-textMuted-rgb, 136 136 136))',
      hellamuted: 'rgb(var(--m-textDim-rgb, 102 102 102))',
      // Archive theme
      'arc-bg': 'rgb(var(--m-arcBg-rgb, 5 5 5))',
      'arc-surface': 'rgb(var(--m-arcSurface-rgb, 10 10 10))',
      'arc-card': 'rgb(var(--m-arcCard-rgb, 13 13 13))',
      'arc-border': 'rgb(255 255 255 / 0.1)',
      'arc-border-hover': 'rgb(255 255 255 / 0.18)',
      'arc-text': 'rgb(var(--m-arcText-rgb, 224 224 224))',
      'arc-muted': 'rgb(var(--m-arcMuted-rgb, 119 119 119))',
      'arc-dim': 'rgb(var(--m-arcDim-rgb, 85 85 85))',
      'arc-accent': 'rgb(var(--m-arcAccent-rgb, 192 192 192))',
      'arc-encrypted': 'rgb(var(--m-arcEncrypted-rgb, 255 51 51))',
    },
  },
  shortcuts: {
    // Dashboard card styling
    'dash-card':
      'bg-dash-card border border-solid border-dash-border hover:border-dash-border-hover transition-colors',
    // Section title
    'dash-section-title':
      'text-xs font-semibold text-dash-text lowercase tracking-wide mb-4 pb-2 border-b-dash-border',
    // Panel section
    'dash-panel-section':
      'bg-dash-panel border border-solid border-dash-border p-5 mb-5 transition-all hover:border-dash-border-hover',
    // Setting item
    'dash-setting': 'mb-3.5',
    // Toggle grid
    'dash-toggle-grid': 'grid grid-cols-1 sm:grid-cols-2 gap-2.5',
    // Color row
    'dash-color-row': 'flex flex-wrap gap-3.5 mb-3.5',
    // Slider row
    'dash-slider-row': 'grid grid-cols-1 md:grid-cols-2 gap-5 mb-3.5',
    // Premium badge
    'dash-premium-badge':
      'bg-primary-dim text-primary border border-solid border-primary text-[10px] px-1.5 py-0.5 font-semibold uppercase tracking-wide',
    // Premium notice
    'dash-premium-notice':
      'flex items-center gap-2 p-3 bg-primary-dim border border-solid border-primary text-primary text-xs',
    // Danger section
    'dash-danger-section': 'border-primary',
    // Info list
    'dash-info-list': 'flex flex-col gap-2.5',
    'dash-info-item':
      'flex justify-between items-center p-2.5 bg-dash-bg border border-solid border-dash-border',
    // Stats
    'dash-stats': 'flex gap-5 p-3.5 bg-dash-bg border border-solid border-dash-border',
    'dash-stat-item': 'flex flex-col gap-1',
    // Social links
    'dash-social-grid': 'flex flex-col gap-2.5',
    'dash-social-item': 'flex items-center gap-2.5',
    'dash-social-icon':
      'w-9 h-9 flex items-center justify-center bg-dash-bg border border-solid border-dash-border text-dash-muted',
    // Archive shortcuts
    'arc-page': 'min-h-screen bg-[#050505] text-[#E0E0E0] relative font-mono',
    'arc-row':
      'flex items-center w-full py-4 px-0 border-b border-solid border-[rgba(255,255,255,0.1)] transition-all duration-200 decoration-none cursor-pointer',
    'arc-title': 'font-mono tracking-[0.25em] uppercase text-[#E0E0E0] font-thin',
    'arc-body': 'font-mono text-sm leading-relaxed text-[#777]',
    'arc-encrypted': 'text-[#ff3333] font-mono text-xs tracking-[0.3em] uppercase opacity-50',
  },
});
