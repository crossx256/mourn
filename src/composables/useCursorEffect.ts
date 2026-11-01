import { onMounted, onUnmounted, watch, type Ref } from 'vue';
import { useRenderingPolicy } from './useRenderingPolicy';

// Strict contract for cursor effect composable
export interface CursorProfile {
  cursorEffect?: string | null;
  customCursor?: string | null;
}

export function useCursorEffect(profile: Ref<CursorProfile | null>) {
  // SSR GUARD — all DOM manipulation (canvas, event listeners) is client-only
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const { animate } = useRenderingPolicy();
  let lastFrame = 0;
  let lastEmission = -Infinity;
  let frameInterval = 1000 / 60;
  let slowFrames = 0;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number | null = null;
  let cursorImage: HTMLImageElement | null = null;

  // Ghost cursor trail state
  type Ghost = { x: number; y: number; lifeSpan: number; initialLifeSpan: number };
  const ghosts: Ghost[] = [];
  const GHOST_LIFESPAN = 40;

  // Particle-based effects state
  type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    size: number;
    color: string;
    opacity?: number;
    angle?: number;
    rotSpeed?: number;
  };
  const particles: Particle[] = [];
  let mouseX = 0;
  let mouseY = 0;

  const initCanvas = () => {
    if (typeof window === 'undefined' || canvas) return;

    canvas = document.createElement('canvas');
    canvas.id = 'cursor-canvas';
    Object.assign(canvas.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      pointerEvents: 'none',
      zIndex: '2147483647',
      width: '100vw',
      height: '100vh',
      inset: '0',
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    schedule();
  };

  const resize = () => {
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      schedule();
    }
  };

  const loadCursorImage = (url: string) => {
    if (!url) {
      cursorImage = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      cursorImage = img;
    };
    img.onerror = () => {
      cursorImage = null;
    };
    img.src = url;
  };

  // Apply (or remove) the CSS cursor on the profile container element
  const applyCssCursor = () => {
    // Use HTMLElement type to ensure .style is available
    const container: HTMLElement | null = document.querySelector('.profile-container');
    if (!container) return;
    const url = profile?.value?.customCursor;
    const effect = profile?.value?.cursorEffect;
    // XSS-sanitized URL for cursor - strict character whitelist
    const sanitizeCursorUrl = (raw: string): string => {
      // Allow only safe URL characters: alphanumeric, common path chars, data: URLs
      // Block: quotes, parens, backslashes, newlines, control chars, script/protocol patterns
      // Using charCodeAt for control character check to avoid ESLint no-control-regex error
      const cleaned = String(raw).replace(/['"\\();\n\r]/g, '');
      // Filter out control chars (0-31 and 127) using charCodeAt in a filter function
      const noControl = cleaned
        .split('')
        .filter((c) => {
          const code = c.charCodeAt(0);
          return code > 31 && code !== 127;
        })
        .join('');
      return noControl.replace(
        /^(javascript|data:text\/html|data:text\/javascript|vbscript):/i,
        '',
      );
    };
    // Effects that need native cursor hidden (only when no custom cursor is set)
    const hideCursorEffects = [
      'cursor-trail',
      'neon-glow',
      'sparkle-dust',
      'fairy-dust',
      'bubbles',
    ];
    if (url) {
      // Custom cursor takes priority - if set, always use it regardless of effect
      const safeUrl = sanitizeCursorUrl(url);
      container.style.cursor = `url('${safeUrl}') 0 0, auto`;
    } else if (
      animate.value &&
      ctx &&
      hideCursorEffects.includes(effect || '') &&
      effect === 'neon-glow'
    ) {
      // Only hide cursor if NO custom cursor is set
      container.style.cursor = 'none';
    } else {
      container.style.cursor = '';
    }
  };

  // Default ghost cursor image (small arrow png) for when no custom image is set
  const defaultGhostImage = new Image();
  defaultGhostImage.src =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAATCAYAAACk9eypAAAAAXNSR0IArs4c6QAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAhGVYSWZNTQAqAAAACAAFARIAAwAAAAEAAQAAARoABQAAAAEAAABKARsABQAAAAEAAABSASgAAwAAAAEAAgAAh2kABAAAAAEAAABaAAAAAAAAAEgAAAABAAAASAAAAAEAA6ABAAMAAAABAAEAAKACAAQAAAABAAAADKADAAQAAAABAAAAEwAAAAAChpcNAAAACXBIWXMAAAsTAAALEwEAmpwYAAABWWlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNS40LjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyI+CiAgICAgICAgIDx0aWZmOk9yaWVudGF0aW9uPjE8L3RpZmY6T3JpZW50YXRpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgpMwidZAAABqElEQVQoFY3SPUvDQBgH8BREpRHExYiDgmLFl6WC+AYmWeyLg4i7buJX8DMpOujgyxGvUYeCgzhUQUSKKLUS0+ZyptXh8Z5Ti621ekPyJHl+uftfomhaf9Ei5JyxXKfynyEA6EYcLHpwyflT958GAQ7DTABNHd8EbtDbEH2BD5QEQmi2mM8P/Iq+A0SzszEg+3sPjDnDdVEtQKQbMUidHD3xVzf6A9UDEmEm+8h9KTqTVUjT+vB53aHrCbAPiceYq1dQI1Aqv4EhMll0jzv+Y0yiRgCnLRSYyDQHVoqUXe4uKL9l+L7GXC4vkMhE6eW/AOJs9k583ORDUyXMZ8F5SVHVVnllmPNKSFagAJ5DofaqGXw/gHBYg51dIldkmknY3tguv3jOtHR4+MqAzaraJXbEhqHhcQlwGSOi5pytVQHZLN5s0WNe8HPrLYlFsO20RPHkImxsbmHdLJFI76th7Z4SeuF53hTeFLvhRCJRCTKZKxgdnRDbW+iozFJbBMw14/ElwGYc0egMBMFzT21f5Rog33Z7dX02GBm7WV5ZfT5Nn5bE3zuCDe9UxdTpNvK+5AAAAABJRU5ErkJggg==';

  const handleMouseMove = (e: MouseEvent) => {
    if (!animate.value || !ctx) return;
    mouseX = e.clientX;
    mouseY = e.clientY;

    schedule();
    const now = performance.now();
    if (now - lastEmission < frameInterval) return;
    lastEmission = now;
    if (ghosts.length >= 40 || particles.length >= 80) return;
    const effect = profile?.value?.cursorEffect;

    if (effect === 'cursor-trail') {
      // Ghost cursor pattern — stamp image at cursor position
      ghosts.push({
        x: mouseX,
        y: mouseY,
        lifeSpan: GHOST_LIFESPAN,
        initialLifeSpan: GHOST_LIFESPAN,
      });
    } else if (effect === 'sparkle-dust') {
      if (Math.random() > 0.5) spawnSparkle(mouseX, mouseY);
    } else if (effect === 'fairy-dust') {
      if (Math.random() > 0.4) spawnFairy(mouseX, mouseY);
    } else if (effect === 'bubbles') {
      if (Math.random() > 0.7) spawnBubble(mouseX, mouseY);
    }
  };

  // ── sparkle-dust particles ──
  const spawnSparkle = (x: number, y: number) => {
    const hue = Math.floor(Math.random() * 60) + 40;
    particles.push({
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      life: 1,
      size: Math.random() * 4 + 2,
      color: `hsl(${hue}, 100%, 75%)`,
      angle: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
    });
  };

  // ── fairy-dust particles ──
  const spawnFairy = (x: number, y: number) => {
    const hue = Math.floor(Math.random() * 360);
    particles.push({
      x: x + (Math.random() - 0.5) * 30,
      y: y + (Math.random() - 0.5) * 30,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -(Math.random() * 0.5 + 0.3),
      life: 1,
      size: Math.random() * 5 + 3,
      color: `hsl(${hue}, 80%, 70%)`,
      opacity: 0.8,
    });
  };

  // ── bubble particles ──
  const spawnBubble = (x: number, y: number) => {
    particles.push({
      x: x + (Math.random() - 0.5) * 20,
      y,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -(Math.random() * 1.5 + 0.8),
      life: 1,
      size: Math.random() * 12 + 6,
      color: `hsla(200, 80%, 75%, 0.5)`,
      opacity: 0.6,
    });
  };

  const drawStar = (cx: number, cy: number, spikes: number, outerR: number, innerR: number) => {
    if (!ctx) return;
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
    ctx.closePath();
    ctx.fill();
  };

  const teardownAnimatedCursor = () => {
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    lastFrame = 0;
    lastEmission = -Infinity;
    ghosts.length = 0;
    particles.length = 0;
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null;
    ctx = null;
  };

  const draw = (step: number) => {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const effect = profile?.value?.cursorEffect;

    // ── spotlight — heavy dimming with radial cutout ──
    if (effect === 'spotlight') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const gradient = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, 160);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.9)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 160, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    // ── neon-glow — color-shifting glow circles at cursor ──
    if (effect === 'neon-glow') {
      const hue = (Date.now() * 0.1) % 360;
      const r = 30;
      // Outer large glow
      const glow = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, r * 3);
      glow.addColorStop(0, `hsla(${hue}, 100%, 65%, 0.5)`);
      glow.addColorStop(0.5, `hsla(${hue}, 100%, 55%, 0.15)`);
      glow.addColorStop(1, `hsla(${hue}, 100%, 55%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, r * 3, 0, Math.PI * 2);
      ctx.fill();
      // Core bright dot
      ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // ── Ghost cursor trail ──
    if (effect === 'cursor-trail') {
      const img = cursorImage && cursorImage.complete ? cursorImage : defaultGhostImage;
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i]!;
        g.lifeSpan -= step;
        if (g.lifeSpan < 0) {
          ghosts.splice(i, 1);
          continue;
        }
        const opacity = Math.max(g.lifeSpan / g.initialLifeSpan, 0);
        ctx.globalAlpha = opacity;
        if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, g.x, g.y);
      }
      ctx.globalAlpha = 1;
      if (ghosts.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    // ── Particle-based effects (sparkle-dust, fairy-dust, bubbles) ──
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (!p) continue;

      if (effect === 'bubbles') {
        p.vy *= 0.99;
        p.vx += (Math.random() - 0.5) * 0.1;
        p.life -= 0.008 * step;
      } else if (effect === 'fairy-dust') {
        p.vx += (Math.random() - 0.5) * 0.15;
        p.vy *= 0.98;
        p.life -= 0.012 * step;
      } else if (effect === 'sparkle-dust') {
        p.life -= 0.025 * step;
        if (p.angle !== undefined && p.rotSpeed !== undefined) {
          p.angle += p.rotSpeed * step;
        }
      }

      p.x += p.vx * step;
      p.y += p.vy * step;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = Math.max(0, p.life) * (p.opacity ?? 1);

      if (effect === 'sparkle-dust') {
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.angle !== undefined) ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        drawStar(0, 0, 4, p.size, p.size * 0.4);
        ctx.restore();
      } else if (effect === 'bubbles') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.25, 0, Math.PI * 2);
        ctx.fill();
      } else if (effect === 'fairy-dust') {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
        glow.addColorStop(0, p.color);
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  };

  const schedule = () => {
    if (animationId === null && ctx && animate.value) {
      animationId = requestAnimationFrame(loop);
    }
  };

  const loop = (now: number) => {
    animationId = null;
    if (!ctx || !animate.value) return;
    const elapsed = lastFrame ? now - lastFrame : frameInterval;
    if (elapsed + 0.5 < frameInterval) {
      schedule();
      return;
    }
    lastFrame = now;
    const started = performance.now();
    draw(Math.min(elapsed / (1000 / 60), 4));
    // Sustained expensive canvas draws degrade once, rather than oscillating quality.
    slowFrames = performance.now() - started > 8 ? slowFrames + 1 : 0;
    if (slowFrames >= 10) frameInterval = 1000 / 30;
    if (ghosts.length || particles.length) schedule();
    else lastFrame = 0;
  };

  onMounted(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove);

    watch(
      () => [profile?.value?.cursorEffect, animate.value] as const,
      ([val, enabled]) => {
        teardownAnimatedCursor();
        if (
          enabled &&
          val &&
          [
            'cursor-trail',
            'spotlight',
            'neon-glow',
            'sparkle-dust',
            'bubbles',
            'fairy-dust',
          ].includes(val)
        ) {
          initCanvas();
        }
        // Clear stale state on effect change
        particles.length = 0;
        ghosts.length = 0;
        // Update CSS cursor when effect changes
        applyCssCursor();
      },
      { immediate: true },
    );

    watch(
      () => profile?.value?.customCursor,
      (url) => {
        if (url) loadCursorImage(url);
        else cursorImage = null;
        // Update CSS cursor when custom cursor changes
        applyCssCursor();
      },
      { immediate: true },
    );
  });

  onUnmounted(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', handleMouseMove);
    teardownAnimatedCursor();
    cursorImage = null;
    ghosts.length = 0;
    particles.length = 0;
    // Reset CSS cursor
    const containerReset: HTMLElement | null = document.querySelector('.profile-container');
    if (containerReset) containerReset.style.cursor = '';
  });
}
