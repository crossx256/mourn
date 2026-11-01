<template>
  <TresPerspectiveCamera
    :position="cameraPosition"
    :look-at="[0, 0, -12]"
    :near="0.1"
    :far="50000"
  />
  <OrbitControls
    make-default
    :enable-damping="!lowMotion"
    :damping-factor="0.05"
    :enable-pan="true"
    :mouse-buttons="{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }"
  />

  <!-- Pass 1: Core stars with lava shader -->
  <!-- Key forces re-creation whenever letters array changes (BufferGeometry resize) -->
  <TresPoints
    v-if="letters.length > 0"
    :key="`core-${letterIdsHash}`"
    ref="corePointsRef"
    :render-order="0"
  >
    <TresBufferGeometry
      :position="[positions, 3]"
      :a-text-size="[textSizes, 1]"
      :a-random-offset="[randomOffsets, 1]"
      :a-age="[ages, 1]"
      :a-flare-angle="[flareAngles, 1]"
      :a-time-visibility="[timeVisibility, 1]"
      :a-rotation-speed="[rotationSpeeds, 1]"
      :a-flare-size="[flareSizes, 1]"
      :a-rotation-axis="[rotationAxes, 3]"
    />
    <primitive :object="coreMaterial" attach="material" />
  </TresPoints>

  <!-- Pass 2: Additive glow halo with dramatic lens flares -->
  <TresPoints
    v-if="letters.length > 0"
    :key="`glow-${letterIdsHash}`"
    ref="glowPointsRef"
    :render-order="1"
  >
    <TresBufferGeometry
      :position="[positions, 3]"
      :a-text-size="[textSizes, 1]"
      :a-random-offset="[randomOffsets, 1]"
      :a-age="[ages, 1]"
      :a-flare-angle="[flareAngles, 1]"
      :a-time-visibility="[timeVisibility, 1]"
      :a-rotation-speed="[rotationSpeeds, 1]"
      :a-flare-size="[flareSizes, 1]"
      :a-rotation-axis="[rotationAxes, 3]"
    />
    <primitive :object="glowMaterial" attach="material" />
  </TresPoints>

  <!-- Glowing Connection Beams (two-pass: core + glow) -->
  <primitive v-if="beamCoreLines" :object="beamCoreLines" />
  <primitive v-if="beamGlowLines" :object="beamGlowLines" />

  <TresAmbientLight :intensity="0.15" />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch, shallowRef, ref, nextTick } from 'vue';
import { useLoop, useTres } from '@tresjs/core';
import { useRenderingPolicy } from 'src/composables/useRenderingPolicy';
import { OrbitControls } from '@tresjs/cientos';
import {
  ShaderMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  Vector3,
  AdditiveBlending,
  Raycaster,
  Vector2,
  TextureLoader,
  type Texture,
  SRGBColorSpace,
  EquirectangularReflectionMapping,
  PointLight,
  type Points,
} from 'three';
import type { Letter } from 'src/types/graveyard';

const props = withDefaults(
  defineProps<{
    letters: Letter[];
    timeProgress: number;
  }>(),
  {
    letters: () => [],
  },
);

const emit = defineEmits<{
  'node-click': [letter: Letter];
}>();

// Template refs for geometry updates (TresPoints component refs)
const corePointsRef = shallowRef<{ $el?: Points } | null>(null);
const glowPointsRef = shallowRef<{ $el?: Points } | null>(null);

// Hash of letter IDs to force re-render when any letter changes
const letterIdsHash = computed(() => {
  return props.letters.map((l) => l.id).join('-');
});

// ---------------------------------------------------------------------------
// Dynamic camera position: scales with spatial range
// ---------------------------------------------------------------------------
const cameraPosition = computed<[number, number, number]>(() => {
  const count = props.letters.length;
  const z = Math.max(50, count * 2.0);
  return [0, 0, z];
});

// ---------------------------------------------------------------------------
// Parse timestamps once
// ---------------------------------------------------------------------------
function getTimestamp(letter: Letter): number {
  const t = new Date(letter.createdAt).getTime();
  return isNaN(t) ? Date.now() : t;
}

// ---------------------------------------------------------------------------
// Seeded random number generator (uses letter timestamp as seed)
// This gives consistent "random" values for each letter (simulates saved positions)
// ---------------------------------------------------------------------------
function seededRandom(seed: number, salt: number = 0): number {
  const x = Math.sin(seed + salt) * 10000;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// Spatial logic: Time-Based Logarithmic Spiral with Dual Range Constraints
//   Formula: ln(r) = a - b*φ  =>  r = e^(a - b*φ)
//   Radius based on TIME not index (oldest = center/red, newest = outer/blue)
//   Range 1: Dynamic range based on time progression
//   Range 2: Fixed MAX range from the logarithmic spiral curve
//   Nodes distributed with SEEDED random scatter (consistent per letter)
// ---------------------------------------------------------------------------
function computeSpatial(index: number) {
  const letters = props.letters;
  if (letters.length === 0) return { x: 0, y: 0, z: 0 };

  // Find earliest letter timestamp
  let minT = Infinity;
  for (const l of letters) {
    const t = getTimestamp(l);
    if (t < minT) minT = t;
  }

  const letter = letters[index]!;
  const thisTime = getTimestamp(letter);

  // Use letter's timestamp as seed for consistent random values
  const seed = thisTime;

  // Radius based on actual elapsed time (in hours) from the oldest letter
  // Uses a dynamic exponent so early graveyards spread more aggressively
  // and older graveyards spread more gently. This exponent varies with
  // the age (maturity) of the graveyard.
  const hoursElapsed = (thisTime - minT) / (1000 * 60 * 60);

  // Graveyard maturity: how old is the graveyard (0..1 over 1 year)
  const graveyardAgeMs = Date.now() - minT;
  const graveyardAgeDays = graveyardAgeMs / (1000 * 60 * 60 * 24);
  const maturityFactor = Math.min(graveyardAgeDays / 365, 1.0);

  // Exponent ranges from ~1.8 (very aggressive early spread) down to 0.5 (gentle long-term)
  const dynamicExponent = 1.8 - maturityFactor * 1.3; // 1.8 -> 0.5

  const constrainedRadius = Math.min(
    200 * Math.pow(Math.max(hoursElapsed, 0.001), dynamicExponent),
    15000,
  );

  // Add seeded random variation within constraints (50% to 100% of radius)
  const randomFactor = 0.5 + seededRandom(seed, 4) * 0.5;
  const finalRadius = constrainedRadius * randomFactor;

  // Seeded random spherical distribution for 3D scatter
  const theta = seededRandom(seed, 5) * Math.PI * 2; // Azimuthal angle
  const polarAngle = Math.acos(2 * seededRandom(seed, 6) - 1); // Uniform on sphere

  // Convert to Cartesian coordinates
  const x = finalRadius * Math.sin(polarAngle) * Math.cos(theta);
  const y = finalRadius * Math.sin(polarAngle) * Math.sin(theta);
  const z = finalRadius * Math.cos(polarAngle);

  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Shared vertex shader — used by both core & glow passes
// Now passes vFlareAngle for per-star flare rotation and time visibility
// ---------------------------------------------------------------------------
function makeVertexShader(sizeMultiplier: number) {
  return /* glsl */ `
    uniform float uTime;
    attribute float aTextSize;
    attribute float aRandomOffset;
    attribute float aAge;
    attribute float aFlareAngle;
    attribute float aTimeVisibility;
    attribute float aRotationSpeed;
    attribute float aFlareSize;
    attribute vec3 aRotationAxis;

    varying float vBrightness;
    varying float vFlicker;
    varying float vAge;
    varying float vOffset;
    varying float vFlareAngle;
    varying float vTimeVisibility;
    varying float vRotationSpeed;
    varying float vFlareSize;
    varying vec3 vRotationAxis;
    varying float vEdgeFactor;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      vBrightness = clamp(aTextSize / 400.0, 0.3, 1.0);
      vAge = aAge;
      vOffset = aRandomOffset;
      vFlareAngle = aFlareAngle;
      vTimeVisibility = aTimeVisibility;
      vRotationSpeed = aRotationSpeed;
      vFlareSize = aFlareSize;
      vRotationAxis = aRotationAxis;

      // Multi-frequency organic flickering
      vFlicker = 0.88
        + 0.06 * sin(uTime * 0.7 + aRandomOffset * 6.2831)
        + 0.03 * sin(uTime * 1.3 + aRandomOffset * 12.5664)
        + 0.02 * sin(uTime * 3.7 + aRandomOffset * 25.1327);

      // Rare bright pulse
      float pulse = pow(max(0.0, sin(uTime * 0.4 + aRandomOffset * 50.0)), 24.0) * 0.12;
      vFlicker += pulse;

      // Scale down invisible stars to 0
      float visibilityScale = smoothstep(0.0, 0.1, aTimeVisibility);
      gl_PointSize = (${sizeMultiplier.toFixed(1)} + aTextSize * 0.018) * (300.0 / length(mvPosition.xyz)) * visibilityScale;

      gl_Position = projectionMatrix * mvPosition;

      // Compute screen-space edge factor: 0.0 = center of screen, 1.0 = edge
      vec2 ndc = gl_Position.xy / gl_Position.w; // -1..1
      vEdgeFactor = clamp(length(ndc), 0.0, 1.0);
    }
  `;
}

// ---------------------------------------------------------------------------
// Pass 1 — HDR plasma ball with procedural lava surface
// Procedural turbulence for organic, molten appearance
// ---------------------------------------------------------------------------
const CORE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying float vBrightness;
  varying float vFlicker;
  varying float vAge;
  varying float vOffset;
  varying float vFlareAngle;
  varying float vTimeVisibility;
  varying float vRotationSpeed;
  varying vec3 vRotationAxis;
  varying float vEdgeFactor;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * valueNoise(p);
      p = p * 2.3 + 0.2;
      a *= 0.48;
    }
    return v;
  }

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv);
    float baseRadius = 0.40;

    // --- Moderate shape distortion (less circular, more organic) ---
    float angle = atan(uv.y, uv.x);
    float distort = 0.0;
    distort += 0.008 * sin(angle * 3.0 + vOffset * 40.0 + uTime * 0.2);
    distort += 0.005 * sin(angle * 5.0 + vOffset * 80.0 - uTime * 0.15);
    distort += 0.003 * sin(angle * 7.0 + vOffset * 120.0 + uTime * 0.1);
    float coreRadius = baseRadius + distort;

    // Soft edge alpha
    float alpha = 1.0 - smoothstep(coreRadius - 0.04, coreRadius, dist);
    if (dist > coreRadius + 0.02) discard;

    float r = clamp(dist / coreRadius, 0.0, 1.0);

    // --- Rotating star surface texture ---
    float rotation = uTime * vRotationSpeed;
    vec2 centeredUV = gl_PointCoord - 0.5;
    float cosR = cos(rotation);
    float sinR = sin(rotation);
    vec2 rotatedUV = vec2(
      cosR * centeredUV.x - sinR * centeredUV.y,
      sinR * centeredUV.x + cosR * centeredUV.y
    ) + 0.5;

    // Multi-layered animated texture
    vec2 texUV = rotatedUV * 7.0 + vOffset * 8.0;
    float lavaPattern = fbm(texUV + uTime * 0.08);
    lavaPattern += fbm(texUV * 2.8 - uTime * 0.12) * 0.8;
    lavaPattern += fbm(texUV * 5.5 + uTime * 0.18) * 0.6;
    lavaPattern += fbm(texUV * 9.0 - uTime * 0.25) * 0.35;
    lavaPattern = lavaPattern / 2.75;
    lavaPattern = pow(lavaPattern, 0.45);

    // --- Hertzsprung-Russell Colour Sequence ---
    vec3 colBlue  = vec3(0.6, 0.75, 1.0);
    vec3 colWhite = vec3(1.0, 0.9, 0.7);
    vec3 colRed   = vec3(1.0, 0.3, 0.1);

    vec3 baseColor;
    if (vAge < 0.5) {
      baseColor = mix(colBlue, colWhite, vAge * 2.0);
    } else {
      baseColor = mix(colWhite, colRed, (vAge - 0.5) * 2.0);
    }

    // Apply texture
    float lavaMod = mix(0.08, lavaPattern * 5.0, 0.99);
    vec3 color = baseColor * lavaMod;

    // Center glow modulated by edge factor: near screen center = subtle,
    // near screen edges = stronger glow (preserves texture when focused)
    float edgeGlowBoost = smoothstep(0.0, 0.7, vEdgeFactor);
    float centerGlow = pow(1.0 - r, 4.0) * mix(0.04, 0.25, edgeGlowBoost);
    color *= (1.0 + centerGlow);

    // Energy multiplier
    float energy = 1.0 + (1.0 - vAge) * 0.5;
    color *= vFlicker * (1.0 + vBrightness * 0.25) * energy;

    // Texture contrast
    float finalContrast = pow(lavaPattern, 0.6);
    color *= mix(0.95, finalContrast * 2.2, 0.7);

    // ── Sparkle Gems: simulated reflections of surrounding stars ──
    // Creates bright pinpoint sparkles that fade darker toward center
    // with colors matching the star's outer rim (orange/warm tones)
    vec2 sparkleUV = rotatedUV * 18.0 + vOffset * 50.0;
    float sparkle = 0.0;

    // Multiple layers of sparkle points at different scales
    for (int i = 0; i < 3; i++) {
      vec2 sUV = sparkleUV * (1.0 + float(i) * 0.7);
      sUV += uTime * 0.03 * (float(i) - 1.0);
      vec2 cellId = floor(sUV);
      vec2 cellUV = fract(sUV) - 0.5;

      // Random position offset within each cell
      vec2 starPos = vec2(hash(cellId) - 0.5, hash(cellId + 7.31) - 0.5) * 0.7;
      float d = length(cellUV - starPos);

      // Sharp sparkle point
      float brightness = hash(cellId + float(i) * 13.7);
      // Animate twinkle
      float twinkle = 0.5 + 0.5 * sin(uTime * (1.5 + brightness * 3.0) + brightness * 30.0);
      // Only keep bright sparkles (sparse)
      float threshold = 0.7 - float(i) * 0.05;
      float point = smoothstep(0.06, 0.0, d) * step(threshold, brightness) * twinkle;
      sparkle += point;
    }

    // Sparkles fade darker toward center, bright at outer rim
    float sparkleMask = smoothstep(0.05, 0.35, r);
    sparkle *= sparkleMask;

    // Sparkle color: warm outer rim tones (orange for older, blue-white for younger)
    vec3 sparkleColor;
    if (vAge < 0.5) {
      sparkleColor = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.95, 0.85), vAge * 2.0);
    } else {
      sparkleColor = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.5, 0.2), (vAge - 0.5) * 2.0);
    }

    color += sparkleColor * sparkle * 1.8;

    // Apply time-based visibility with smooth fade-in
    float visibilityAlpha = smoothstep(0.0, 0.15, vTimeVisibility);
    alpha *= visibilityAlpha;

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Pass 2 — HDR corona + per-star rotated lens flares
// Each star has unique flare rotation angle for visual variety
// ---------------------------------------------------------------------------
const GLOW_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying float vBrightness;
  varying float vFlicker;
  varying float vAge;
  varying float vOffset;
  varying float vFlareAngle;
  varying float vTimeVisibility;
  varying float vRotationSpeed;
  varying float vFlareSize;
  varying float vEdgeFactor;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float r = dist / 0.5; // 0..1

    // --- Per-star rotation of all spikes ---
    float ca = cos(vFlareAngle);
    float sa = sin(vFlareAngle);
    vec2 ruv = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);

    // --- Screen-position-dependent glow intensity ---
    // Near center of screen: glow fades smoothly to reveal texture
    // Near edges: glow becomes dramatically stronger (intended look)
    float edgeMul = smoothstep(0.0, 0.65, vEdgeFactor);
    float glowStrength = mix(0.15, 1.0, edgeMul); // 15% at center, 100% at edges

    // --- Corona glow ---
    float tightGlow = exp(-r * 18.0) * 4.0 * glowStrength;
    float softGlow  = exp(-r * 5.0) * 1.0 * glowStrength;

    // --- Diffraction spikes (also scale with edge factor) ---
    float flareIntensity = vFlareSize * glowStrength;

    float spike1 = exp(-abs(ruv.y) * 100.0 - abs(ruv.x) * 2.0) * 6.5 * flareIntensity;
    float spike2 = exp(-abs(ruv.x) * 70.0 - abs(ruv.y) * 3.5) * 3.0 * flareIntensity;

    vec2 duv = vec2(ruv.x * 0.7071 - ruv.y * 0.7071,
                    ruv.x * 0.7071 + ruv.y * 0.7071);
    float spike3 = exp(-abs(duv.y) * 80.0 - abs(duv.x) * 5.0) * 1.2 * flareIntensity;
    float spike4 = exp(-abs(duv.x) * 80.0 - abs(duv.y) * 5.0) * 1.2 * flareIntensity;

    float spike5 = exp(-abs(ruv.y) * 140.0 - abs(ruv.x) * 1.5) * 0.8 * flareIntensity;
    float spike6 = exp(-abs(ruv.x) * 100.0 - abs(ruv.y) * 3.0) * 0.5 * flareIntensity;

    float totalLight = tightGlow + softGlow + spike1 + spike2 + spike3 + spike4 + spike5 + spike6;

    // Subtle animation
    totalLight *= 0.9 + 0.1 * sin(uTime * 2.0 + vOffset * 10.0);

    // --- Hertzsprung-Russell Colour (matches core) ---
    vec3 colBlue  = vec3(0.4, 0.6, 1.0);
    vec3 colWhite = vec3(1.0, 0.92, 0.82);
    vec3 colRed   = vec3(1.0, 0.1, 0.05);

    vec3 lightColor;
    if (vAge < 0.5) {
      lightColor = mix(colBlue, colWhite, vAge * 2.0);
    } else {
      lightColor = mix(colWhite, colRed, (vAge - 0.5) * 2.0);
    }

    // HDR energy: young/blue stars glow much brighter
    float energy = 1.0 + (1.0 - vAge) * 2.5;
    vec3 finalColor = lightColor * totalLight * vFlicker * energy;

    // Soft outer fade
    float alpha = 1.0 - pow(r, 4.0);

    // Apply time-based visibility with smooth fade-in
    float visibilityAlpha = smoothstep(0.0, 0.15, vTimeVisibility);
    alpha *= visibilityAlpha;

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
const uTimeUniform = { value: 0.0 };

// Core: transparent for soft alpha edge, depth-writing for occlusion
const coreMaterial = new ShaderMaterial({
  vertexShader: makeVertexShader(90.0),
  fragmentShader: CORE_FRAGMENT,
  uniforms: { uTime: uTimeUniform },
  transparent: true,
  depthWrite: true,
  depthTest: true,
});

// Glow: additive HDR corona + lens flares
const glowMaterial = new ShaderMaterial({
  vertexShader: makeVertexShader(140.0),
  fragmentShader: GLOW_FRAGMENT,
  uniforms: { uTime: uTimeUniform },
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: AdditiveBlending,
});

// ---------------------------------------------------------------------------
// Fly-to animation state
// ---------------------------------------------------------------------------
interface FlyState {
  startPos: Vector3;
  startTarget: Vector3;
  endPos: Vector3;
  endTarget: Vector3;
  letterId: string;
  progress: number;
}

const flyState = ref<FlyState | null>(null);
const FLY_DURATION = 1.8; // seconds - slightly longer for smoother motion

// Smoother easing function for more elegant camera movement
function easeInOutQuart(t: number): number {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

// ---------------------------------------------------------------------------
// Keyboard controls (WASD + Shift for speed) with Pointer Lock (FPS mode)
// ---------------------------------------------------------------------------
const keyState = ref<{ [key: string]: boolean }>({});
const BASE_MOVE_SPEED = 375.0; // units per second (25x original - very fast!)
const SHIFT_MULTIPLIER = 3.0; // 3x faster with shift
const isPointerLocked = ref(false);
const mouseDeltaX = ref(0);
const mouseDeltaY = ref(0);
const MOUSE_SENSITIVITY = 0.002; // radians per pixel

function onKeyDown(event: KeyboardEvent) {
  const key = event.key.toLowerCase();

  // Don't handle game controls when typing in inputs/textareas
  const target = event.target as HTMLElement;
  const isTyping =
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.closest('.terminal-popup') !== null); // Letter drawer
  if (isTyping) return;

  // Movement keys
  if (['w', 'a', 's', 'd', 'shift'].includes(key)) {
    keyState.value[key] = true;
  }

  // F key toggles FPS mode (pointer lock)
  if (key === 'f') {
    if (isPointerLocked.value) {
      document.exitPointerLock();
    } else if (renderer) {
      renderer.domElement.requestPointerLock().catch(() => {
        console.warn('Pointer lock request failed');
      });
    }
  }

  // ESC to exit pointer lock
  if (event.key === 'Escape' && isPointerLocked.value) {
    document.exitPointerLock();
  }
}

function onKeyUp(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'shift'].includes(key)) {
    keyState.value[key] = false;
  }
}

function onPointerLockChange() {
  isPointerLocked.value = document.pointerLockElement === renderer?.domElement;

  // Disable orbit controls when pointer is locked
  if (controls.value) {
    const ctrl = controls.value as unknown as { enabled: boolean };
    ctrl.enabled = !isPointerLocked.value;
  }
}

function onMouseMove(event: MouseEvent) {
  if (isPointerLocked.value) {
    mouseDeltaX.value = event.movementX;
    mouseDeltaY.value = event.movementY;
  }
}

// Exit FPS mode on any mouse button click
function onMouseDownFpsExit(event: MouseEvent) {
  if (isPointerLocked.value) {
    event.preventDefault();
    document.exitPointerLock();
  }
}

// ---------------------------------------------------------------------------
// HDRI background intensity: scales with timeProgress and graveyard age
//   timeProgress 0 (oldest) → low opacity | timeProgress 1 (now) → high opacity
//   < 1 year old: 10% → 80%    |   >= 1 year old: 10% → 100%
//   Smoothly interpolates between these ranges as the graveyard approaches 1 year
// ---------------------------------------------------------------------------
const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

const backgroundIntensity = computed(() => {
  const letters = props.letters;
  if (letters.length === 0) return 0.1;

  // Find oldest letter timestamp
  let minT = Infinity;
  for (const l of letters) {
    const t = getTimestamp(l);
    if (t < minT) minT = t;
  }

  // How old is the graveyard? (0..1 clamped, where 1 = one year or older)
  const graveyardAgeMs = Date.now() - minT;
  const ageFraction = Math.min(graveyardAgeMs / ONE_YEAR_MS, 1.0);

  // Max opacity ramps from 0.80 (brand new) to 1.0 (1 year+)
  const maxOpacity = 0.8 + ageFraction * 0.2;
  const minOpacity = 0.1;

  // Linearly interpolate based on timeProgress
  return minOpacity + (maxOpacity - minOpacity) * props.timeProgress;
});

// ---------------------------------------------------------------------------
// Render-loop: advance uTime every frame + fly-to interpolation + WASD movement
// ---------------------------------------------------------------------------
let lastElapsed: number | null = null;
const { visible, lowMotion } = useRenderingPolicy();
const { onBeforeRender, stop, start } = useLoop();
watch(
  visible,
  (shown) => {
    lastElapsed = null;
    if (shown) start();
    else {
      stop();
      keyState.value = {};
      mouseDeltaX.value = 0;
      mouseDeltaY.value = 0;
    }
  },
  { immediate: true },
);

onBeforeRender(({ elapsed }) => {
  // If the WebGL context was lost (GPU reset / driver handoff), hold the last
  // frame instead of driving the dead canvas. Three.js re-initializes resources
  // automatically on `webglcontextrestored`; we just resume ticking uTime.
  if (isContextLost()) {
    return;
  }

  const delta = lastElapsed === null ? 0 : Math.min(0.05, Math.max(0, elapsed - lastElapsed));
  lastElapsed = elapsed;
  if (!lowMotion.value) uTimeUniform.value += delta;

  // HDRI recession: rotate background slightly opposite to camera movement
  // so background stars seem to recede as you fly toward them
  if (scene.value && camera.value) {
    const camPos = camera.value.position;
    const dist = camPos.length();
    if (dist > 1.0) {
      scene.value.backgroundRotation.y = -camPos.x * 0.00004;
      scene.value.backgroundRotation.x = camPos.y * 0.00004;
    }

    // Apply timeline-dependent background brightness
    scene.value.backgroundIntensity = backgroundIntensity.value;
  }

  // FPS camera rotation (when pointer is locked)
  if (isPointerLocked.value && controls.value && camera.value) {
    const ctrl = controls.value as unknown as {
      object: { position: Vector3; rotation: { x: number; y: number; z: number } };
      target: Vector3;
      update: () => void;
    };

    // Apply mouse rotation
    if (mouseDeltaX.value !== 0 || mouseDeltaY.value !== 0) {
      // Calculate current view direction
      const forward = new Vector3().subVectors(ctrl.target, ctrl.object.position).normalize();
      const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();

      // Yaw (horizontal rotation)
      const yawAngle = -mouseDeltaX.value * MOUSE_SENSITIVITY;
      const yawAxis = new Vector3(0, 1, 0);
      forward.applyAxisAngle(yawAxis, yawAngle);

      // Pitch (vertical rotation)
      const pitchAngle = -mouseDeltaY.value * MOUSE_SENSITIVITY;
      forward.applyAxisAngle(right, pitchAngle);

      // Update target based on new forward direction
      ctrl.target.copy(ctrl.object.position).add(forward.multiplyScalar(100));
      ctrl.update();

      // Reset mouse delta
      mouseDeltaX.value = 0;
      mouseDeltaY.value = 0;
    }
  }

  // WASD keyboard movement (only in FPS mode when pointer is locked)
  if (!flyState.value && controls.value && camera.value && isPointerLocked.value) {
    const ctrl = controls.value as unknown as {
      object: { position: Vector3 };
      target: Vector3;
      update: () => void;
    };

    const moveSpeed = keyState.value['shift']
      ? BASE_MOVE_SPEED * SHIFT_MULTIPLIER
      : BASE_MOVE_SPEED;
    const moveDistance = moveSpeed * delta;

    if (
      moveDistance > 0 &&
      (keyState.value['w'] || keyState.value['a'] || keyState.value['s'] || keyState.value['d'])
    ) {
      // Get camera's forward and right vectors
      const forward = new Vector3().subVectors(ctrl.target, ctrl.object.position).normalize();
      const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();

      const movement = new Vector3();

      if (keyState.value['w']) movement.add(forward.multiplyScalar(moveDistance));
      if (keyState.value['s']) movement.add(forward.multiplyScalar(-moveDistance));
      if (keyState.value['d']) movement.add(right.multiplyScalar(moveDistance));
      if (keyState.value['a']) movement.add(right.multiplyScalar(-moveDistance));

      ctrl.object.position.add(movement);
      ctrl.target.add(movement);
      ctrl.update();
    }
  }

  // Fly-to animation
  if (flyState.value && controls.value) {
    flyState.value.progress = lowMotion.value ? 1 : flyState.value.progress + delta / FLY_DURATION;
    const ctrl = controls.value as unknown as {
      object: { position: Vector3 };
      target: Vector3;
      update: () => void;
      enabled: boolean;
    };
    if (flyState.value.progress >= 1.0) {
      ctrl.object.position.copy(flyState.value.endPos);
      ctrl.target.copy(flyState.value.endTarget);
      ctrl.update();
      ctrl.enabled = true;
      flyState.value = null;
      // Don't re-emit node-click here — the caller (onPointClick) already emitted it
    } else {
      const t = easeInOutQuart(flyState.value.progress);
      const newPos = new Vector3().lerpVectors(flyState.value.startPos, flyState.value.endPos, t);
      const newTarget = new Vector3().lerpVectors(
        flyState.value.startTarget,
        flyState.value.endTarget,
        t,
      );
      ctrl.object.position.copy(newPos);
      ctrl.target.copy(newTarget);
      ctrl.update();
    }
  }
});

// ---------------------------------------------------------------------------
// Camera reset – uses controls.reset() to return to initial state
// ---------------------------------------------------------------------------
const { controls, renderer, scene, camera } = useTres();

// ---------------------------------------------------------------------------
// HDRI Starfield Background
// ---------------------------------------------------------------------------
let backgroundTexture: Texture | null = null;
let sceneDisposed = false;

function loadHdriBackground() {
  if (!scene.value) return;
  const loader = new TextureLoader();
  loader.load('/plain_starfield_less_blue_2.png', (texture) => {
    if (sceneDisposed || !scene.value) {
      texture.dispose();
      return;
    }
    backgroundTexture?.dispose();
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = SRGBColorSpace;
    backgroundTexture = texture;
    scene.value.background = texture;
  });
}

// ---------------------------------------------------------------------------
// Central Point Light (emits into the HDRI field so nearby stars look lit)
// ---------------------------------------------------------------------------
const centralLight = shallowRef<PointLight | null>(null);

function setupCentralLight() {
  if (!scene.value) return;
  const light = new PointLight(0xffe8d0, 2.0, 0, 1.5);
  light.position.set(0, 0, 0);
  scene.value.add(light);
  centralLight.value = light;
}

function resetCamera() {
  flyState.value = null;
  if (controls.value) {
    const ctrl = controls.value as unknown as { reset: () => void; enabled: boolean };
    ctrl.enabled = true;
    ctrl.reset();
  }
}

function flyToNode(letterId: string) {
  const idx = props.letters.findIndex((l) => l.id === letterId);
  if (idx < 0) return;
  const s = computeSpatial(idx);
  const dest = new Vector3(s.x, s.y, s.z);

  if (controls.value) {
    const ctrl = controls.value as unknown as {
      object: { position: Vector3 };
      target: Vector3;
      enabled: boolean;
    };
    ctrl.enabled = false;

    // Calculate camera distance based on star distance from origin (EXTREMELY CLOSE)
    const distFromOrigin = Math.sqrt(dest.x * dest.x + dest.y * dest.y + dest.z * dest.z);
    const cameraDistance = Math.max(40, distFromOrigin * 0.02); // Min 40 units, or 2% of distance - extremely close

    // Default position: camera behind the star relative to origin
    const dirFromOrigin = new Vector3(dest.x, dest.y, dest.z).normalize();
    let cameraOffset = dirFromOrigin.multiplyScalar(cameraDistance);
    let candidatePos = new Vector3(
      dest.x + cameraOffset.x,
      dest.y + cameraOffset.y,
      dest.z + cameraOffset.z,
    );

    // --- Rotation limit: max ±75 degrees ---
    const currentPos = ctrl.object.position.clone();
    const currentDir = new Vector3().subVectors(ctrl.target, currentPos).normalize();
    const targetDir = new Vector3().subVectors(dest, candidatePos).normalize();
    const rotationAngle = Math.acos(Math.max(-1, Math.min(1, currentDir.dot(targetDir))));
    const maxRotationRad = (75 * Math.PI) / 180; // 75 degrees in radians

    if (rotationAngle > maxRotationRad) {
      // Too much rotation - find alternative camera position within rotation limit
      // Strategy: Move camera to a position that's within 75° rotation while still looking at dest

      // Calculate the cone axis (current view direction)
      const coneAxis = currentDir.clone();

      // Find the point on the cone surface closest to our ideal position
      // This is done by rotating the current direction towards the target direction by exactly maxRotationRad
      const rotationAxis = new Vector3().crossVectors(currentDir, targetDir).normalize();

      // If vectors are parallel or anti-parallel, use a perpendicular vector
      if (rotationAxis.length() < 0.01) {
        // Vectors are aligned or opposite - pick any perpendicular direction
        const perpendicular =
          Math.abs(currentDir.x) < 0.9
            ? new Vector3(1, 0, 0).cross(currentDir).normalize()
            : new Vector3(0, 1, 0).cross(currentDir).normalize();
        cameraOffset = perpendicular.multiplyScalar(cameraDistance);
      } else {
        // Rotate currentDir by maxRotationRad around the rotation axis
        const cos = Math.cos(maxRotationRad);
        const sin = Math.sin(maxRotationRad);
        const limitedDir = new Vector3();

        // Rodrigues' rotation formula
        limitedDir.copy(coneAxis.multiplyScalar(cos));
        limitedDir.add(new Vector3().crossVectors(rotationAxis, coneAxis).multiplyScalar(sin));
        limitedDir.add(rotationAxis.multiplyScalar(rotationAxis.dot(coneAxis) * (1 - cos)));
        limitedDir.normalize();

        // Position camera at cameraDistance from dest, looking along limitedDir
        cameraOffset = limitedDir.multiplyScalar(-cameraDistance);
      }

      candidatePos = new Vector3(
        dest.x + cameraOffset.x,
        dest.y + cameraOffset.y,
        dest.z + cameraOffset.z,
      );
    }

    flyState.value = {
      startPos: currentPos,
      startTarget: ctrl.target.clone(),
      endPos: candidatePos,
      endTarget: dest,
      letterId,
      progress: 0,
    };
  }
}

defineExpose({ resetCamera, flyToNode });

// ---------------------------------------------------------------------------
// Geometry data (positions computed from spatial logic)
// ---------------------------------------------------------------------------

// Force geometry attribute updates when letters change
// This is needed because TresBufferGeometry doesn't always detect Float32Array changes
watch(
  () => [props.letters.length, letterIdsHash.value],
  () => {
    void nextTick(() => {
      // Update core points geometry
      const corePoints = corePointsRef.value?.$el;
      if (corePoints?.geometry) {
        const geom = corePoints.geometry;
        geom.attributes.position = new Float32BufferAttribute(positions.value, 3);
        geom.attributes.aTextSize = new Float32BufferAttribute(textSizes.value, 1);
        geom.attributes.aRandomOffset = new Float32BufferAttribute(randomOffsets.value, 1);
        geom.attributes.aAge = new Float32BufferAttribute(ages.value, 1);
        geom.attributes.aFlareAngle = new Float32BufferAttribute(flareAngles.value, 1);
        geom.attributes.aTimeVisibility = new Float32BufferAttribute(timeVisibility.value, 1);
        geom.attributes.aRotationSpeed = new Float32BufferAttribute(rotationSpeeds.value, 1);
        geom.attributes.aFlareSize = new Float32BufferAttribute(flareSizes.value, 1);
        geom.attributes.aRotationAxis = new Float32BufferAttribute(rotationAxes.value, 3);
        geom.attributes.position.needsUpdate = true;
      }

      // Update glow points geometry
      const glowPoints = glowPointsRef.value?.$el;
      if (glowPoints?.geometry) {
        const geom = glowPoints.geometry;
        geom.attributes.position = new Float32BufferAttribute(positions.value, 3);
        geom.attributes.aTextSize = new Float32BufferAttribute(textSizes.value, 1);
        geom.attributes.aRandomOffset = new Float32BufferAttribute(randomOffsets.value, 1);
        geom.attributes.aAge = new Float32BufferAttribute(ages.value, 1);
        geom.attributes.aFlareAngle = new Float32BufferAttribute(flareAngles.value, 1);
        geom.attributes.aTimeVisibility = new Float32BufferAttribute(timeVisibility.value, 1);
        geom.attributes.aRotationSpeed = new Float32BufferAttribute(rotationSpeeds.value, 1);
        geom.attributes.aFlareSize = new Float32BufferAttribute(flareSizes.value, 1);
        geom.attributes.aRotationAxis = new Float32BufferAttribute(rotationAxes.value, 3);
      }
    });
  },
  { flush: 'post' },
);

const positions = computed(() => {
  const p = new Float32Array(props.letters.length * 3);
  props.letters.forEach((_l, i) => {
    const s = computeSpatial(i);
    p[i * 3] = s.x;
    p[i * 3 + 1] = s.y;
    p[i * 3 + 2] = s.z;
  });
  return p;
});

// aTextSize: content character count → drives point size & brightness
const textSizes = computed(() => {
  const s = new Float32Array(props.letters.length);
  props.letters.forEach((l, i) => {
    s[i] = l.content.length;
  });
  return s;
});

// aRandomOffset: deterministic per-point value (0–1) for flicker phase
const randomOffsets = computed(() => {
  const r = new Float32Array(props.letters.length);
  props.letters.forEach((_l, i) => {
    r[i] = ((i * 7919 + 104729) % 999983) / 999983;
  });
  return r;
});

// aAge: absolute age — 0.0 = brand new (blue), 1.0 = 1+ year old (red)
// Every star starts blue and gradually shifts to red over 1 year
const ages = computed(() => {
  const a = new Float32Array(props.letters.length);
  const now = Date.now();

  props.letters.forEach((l, i) => {
    const ageMs = now - getTimestamp(l);
    a[i] = Math.min(ageMs / ONE_YEAR_MS, 1.0);
  });
  return a;
});

// aFlareAngle: per-star random rotation for flare spikes (0 to 2π)
const flareAngles = computed(() => {
  const f = new Float32Array(props.letters.length);
  props.letters.forEach((_l, i) => {
    f[i] = (((i * 13397 + 71711) % 999983) / 999983) * Math.PI * 2;
  });
  return f;
});

// aRotationSpeed: per-star random rotation speed (clearly visible rotation)
// Range: 0.1 to 0.3 radians per second for visible rotation
const rotationSpeeds = computed(() => {
  const r = new Float32Array(props.letters.length);
  props.letters.forEach((_l, i) => {
    const rand = ((i * 17389 + 93911) % 999983) / 999983;
    // Map to range [0.1, 0.3] for clearly visible rotation (some stars rotate forward, some backward)
    r[i] = (rand > 0.5 ? 1 : -1) * (0.1 + (rand % 0.5) * 0.4);
  });
  return r;
});

// aFlareSize: per-star random flare spike size multiplier
// Range: 0.4 to 1.2 for variety (0.4x smallest, 1.2x largest)
const flareSizes = computed(() => {
  const f = new Float32Array(props.letters.length);
  props.letters.forEach((_l, i) => {
    const rand = ((i * 23917 + 81929) % 999983) / 999983;
    // Map to range [0.4, 1.2]
    f[i] = 0.4 + rand * 0.8;
  });
  return f;
});

// aRotationAxis: per-star random 3D rotation axis (normalized)
// Each star rotates around its own unique axis like real celestial bodies
const rotationAxes = computed(() => {
  const axes = new Float32Array(props.letters.length * 3);
  props.letters.forEach((_l, i) => {
    // Generate random axis using different seeds
    const rx = (((i * 31391 + 74897) % 999983) / 999983) * 2 - 1;
    const ry = (((i * 47059 + 89681) % 999983) / 999983) * 2 - 1;
    const rz = (((i * 59399 + 91837) % 999983) / 999983) * 2 - 1;

    // Normalize the axis
    const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
    axes[i * 3] = rx / len;
    axes[i * 3 + 1] = ry / len;
    axes[i * 3 + 2] = rz / len;
  });
  return axes;
});

// aTimeVisibility: controls which stars are visible based on time slider
// 0.0 = invisible (future), 1.0 = fully visible (past or current)
const timeVisibility = computed(() => {
  const v = new Float32Array(props.letters.length);
  if (props.letters.length === 0) return v;

  let minT = Infinity,
    maxT = -Infinity;
  for (const l of props.letters) {
    const t = getTimestamp(l);
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  const range = maxT - minT || 1;
  const buffer = range * 0.002; // tiny buffer beyond maxT so newest letter is visible

  // timeProgress: 0.0 = beginning of time (only oldest visible)
  //               1.0 = current time (all visible)
  const currentTime = minT + (range + buffer) * props.timeProgress;

  props.letters.forEach((l, i) => {
    const letterTime = getTimestamp(l);
    // Stars appear AT EXACTLY their timestamp (instant visibility, no fade)
    // Tiny 0.1% transition just for smoothness
    const transitionRange = range * 0.001; // 0.1% for nearly instant appearance
    const visibility = (currentTime - letterTime) / transitionRange;
    v[i] = Math.max(0, Math.min(1, visibility));
  });

  return v;
});

// ---------------------------------------------------------------------------
// Glowing Connection Beams (subtle light threads between mentions)
// Two-pass rendering: core beam + outer glow for visibility at all distances
// ---------------------------------------------------------------------------
const beamCoreMaterial = new ShaderMaterial({
  vertexShader: /* glsl */ `
    attribute float aVisibility;
    varying float vVisibility;
    varying vec3 vColor;
    void main() {
      vColor = vec3(1.0, 1.0, 1.0);
      vVisibility = aVisibility;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vVisibility;
    void main() {
      if (vVisibility < 0.01) discard;
      gl_FragColor = vec4(vColor, 0.012 * vVisibility);
    }
  `,
  transparent: true,
  blending: AdditiveBlending,
  depthWrite: false,
  depthTest: true,
});

const beamGlowMaterial = new ShaderMaterial({
  vertexShader: /* glsl */ `
    attribute float aVisibility;
    varying float vVisibility;
    varying vec3 vColor;
    void main() {
      vColor = vec3(0.8, 0.9, 1.0);
      vVisibility = aVisibility;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vVisibility;
    void main() {
      if (vVisibility < 0.01) discard;
      gl_FragColor = vec4(vColor, 0.005 * vVisibility);
    }
  `,
  transparent: true,
  blending: AdditiveBlending,
  depthWrite: false,
  depthTest: true,
});

const beamCoreLines = shallowRef<LineSegments | null>(null);
const beamGlowLines = shallowRef<LineSegments | null>(null);

// Helper: get computed position for letter at index i
function posAt(i: number) {
  return computeSpatial(i);
}

// Store beam connection index pairs so we can update visibility without rebuilding geometry
const beamConnections = ref<Array<[number, number]>>([]);

watch(
  () => props.letters,
  (letters) => {
    // Dispose old geometries
    if (beamCoreLines.value) {
      beamCoreLines.value.geometry.dispose();
    }
    if (beamGlowLines.value) {
      beamGlowLines.value.geometry.dispose();
    }

    const pts: number[] = [];
    const connections: Array<[number, number]> = [];

    // Build a map of id → array-index for lookups
    const idToIndex = new Map<string, number>();
    letters.forEach((l, i) => {
      idToIndex.set(l.id, i);
    });

    // Build connection lines between mentions (links to center of each node)
    letters.forEach((letter, i) => {
      letter.mentions?.forEach((mention) => {
        const targetIdx = idToIndex.get(mention.id);
        if (targetIdx !== undefined) {
          const a = posAt(i);
          const b = posAt(targetIdx);
          pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
          connections.push([i, targetIdx]);
        }
      });
    });

    beamConnections.value = connections;

    if (pts.length === 0) {
      beamCoreLines.value = null;
      beamGlowLines.value = null;
      return;
    }

    // Build visibility attribute (2 verts per connection: start + end)
    const vis = new Float32Array(connections.length * 2);
    const tv = timeVisibility.value;
    connections.forEach(([srcIdx, tgtIdx], ci) => {
      // A beam is only visible if BOTH connected nodes are visible
      const minVis = Math.min(tv[srcIdx] ?? 0, tv[tgtIdx] ?? 0);
      vis[ci * 2] = minVis;
      vis[ci * 2 + 1] = minVis;
    });

    // Create geometry with position + visibility
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(pts, 3));
    geom.setAttribute('aVisibility', new Float32BufferAttribute(vis, 1));

    const coreObj = new LineSegments(geom, beamCoreMaterial);
    beamCoreLines.value = coreObj;

    const glowGeom = geom.clone();
    const glowObj = new LineSegments(glowGeom, beamGlowMaterial);
    beamGlowLines.value = glowObj;
  },
  { immediate: true, deep: true },
);

// Update beam visibility when time slider changes
watch(
  () => props.timeProgress,
  () => {
    const connections = beamConnections.value;
    if (connections.length === 0) return;

    const tv = timeVisibility.value;
    const vis = new Float32Array(connections.length * 2);
    connections.forEach(([srcIdx, tgtIdx], ci) => {
      const minVis = Math.min(tv[srcIdx] ?? 0, tv[tgtIdx] ?? 0);
      vis[ci * 2] = minVis;
      vis[ci * 2 + 1] = minVis;
    });

    if (beamCoreLines.value) {
      beamCoreLines.value.geometry.setAttribute('aVisibility', new Float32BufferAttribute(vis, 1));
    }
    if (beamGlowLines.value) {
      beamGlowLines.value.geometry.setAttribute('aVisibility', new Float32BufferAttribute(vis, 1));
    }
  },
);

// ---------------------------------------------------------------------------
// Manual raycasting for hover and click detection
// ---------------------------------------------------------------------------
// Hover and click detection state
const isHoveringPoint = ref(false);
const raycaster = new Raycaster();
// Set threshold for clickable area around stars (matches click threshold)
raycaster.params.Points = { threshold: 30 };
const mouse = new Vector2();

// Track mouse movement to prevent click-while-dragging
const mouseDownPos = ref<{ x: number; y: number } | null>(null);
const DRAG_THRESHOLD = 5; // pixels - if mouse moves more than this, it's a drag not a click

// Manual hover detection for points (TresPoints doesn't support @pointer-over natively)
let hoverRaycastFrame: number | null = null;
let latestHoverEvent: MouseEvent | null = null;

function runHoverRaycast() {
  hoverRaycastFrame = null;
  const event = latestHoverEvent;
  latestHoverEvent = null;
  if (!event || !visible.value || !renderer || !scene.value || !camera.value) return;

  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();

  // Convert mouse position to normalized device coordinates (-1 to +1)
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera.value);

  // Find all points objects in the scene
  const pointsObjects = scene.value.children.filter((obj): obj is Points => {
    return 'isPoints' in obj && Boolean((obj as { isPoints?: boolean }).isPoints);
  });

  // Check for intersections with points
  const intersects = raycaster.intersectObjects(pointsObjects, false);

  if (intersects.length > 0) {
    if (!isHoveringPoint.value) {
      isHoveringPoint.value = true;
      document.body.style.cursor = 'pointer';
    }
  } else {
    if (isHoveringPoint.value) {
      isHoveringPoint.value = false;
      document.body.style.cursor = 'default';
    }
  }
}

function onCanvasMouseMove(event: MouseEvent) {
  latestHoverEvent = event;
  if (hoverRaycastFrame === null) hoverRaycastFrame = requestAnimationFrame(runHoverRaycast);
}

// Track mouse down position to detect dragging
function onCanvasMouseDown(event: MouseEvent) {
  mouseDownPos.value = { x: event.clientX, y: event.clientY };
}

// Manual click detection with raycasting
function onCanvasClick(event: MouseEvent) {
  if (!renderer || !scene.value || !camera.value) return;

  // Don't process star clicks when in pointer lock mode (FPS mode)
  if (isPointerLocked.value) {
    return;
  }

  // Check if this was a drag (mouse moved significantly during click)
  if (mouseDownPos.value) {
    const dx = Math.abs(event.clientX - mouseDownPos.value.x);
    const dy = Math.abs(event.clientY - mouseDownPos.value.y);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > DRAG_THRESHOLD) {
      mouseDownPos.value = null;
      return; // This was a drag, not a click
    }
  }
  mouseDownPos.value = null;

  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();

  // Convert mouse position to normalized device coordinates (-1 to +1)
  const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Update raycaster
  raycaster.setFromCamera(new Vector2(mouseX, mouseY), camera.value);

  // Find all points objects in the scene
  const pointsObjects = scene.value.children.filter((obj): obj is Points => {
    return 'isPoints' in obj && Boolean((obj as { isPoints?: boolean }).isPoints);
  });

  // Check for intersections with points
  const intersects = raycaster.intersectObjects(pointsObjects, false);

  if (intersects.length > 0) {
    const intersection = intersects[0]!;
    const idx = intersection.index;

    if (idx !== undefined && idx >= 0 && idx < props.letters.length) {
      const letter = props.letters[idx]!;

      // Fly camera to this star AND show the letter popup
      flyToNode(letter.id);
      emit('node-click', letter);
    }
  }
}

const sceneCleanup: Array<() => void> = [];

// Set up mouse move, down, and click listeners on canvas + keyboard listeners + pointer lock
onMounted(() => {
  if (renderer) {
    const canvas = renderer.domElement;

    // Cap the render target to the DPR the GPU actually needs. On high-DPI
    // (Retina/4K) displays an uncapped ratio can request a huge buffer that
    // tanks fill rate on weaker/older GPU drivers — one cause of "stars stop
    // rendering / ~20% FPS" on hybrid-GPU machines. 2x is visually crisp.
    const applyPixelRatio = () => {
      const dprCap = lowMotion.value ? 1 : 1.5;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    };
    applyPixelRatio();
    const stopPixelRatioWatch = watch(lowMotion, applyPixelRatio);
    sceneCleanup.push(stopPixelRatioWatch);

    // WebGL context loss is NOT fatal: WebKit/WebGL2 recovers the context.
    // Listen for (re)acquisition so the loop never drives a dead canvas, and
    // cancel the browser's default "reload to recover" prompt (returns true =
    // we will handle restoration ourselves via the render loop's implicit
    // re-bind on the next frame).
    canvas.addEventListener('webglcontextlost', onWebglContextLost as EventListener, false);
    canvas.addEventListener('webglcontextrestored', onWebglContextRestored as EventListener, false);

    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('click', onCanvasClick);
  }

  // Add keyboard listeners for WASD movement
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Add pointer lock listeners
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDownFpsExit);

  // Load HDRI starfield background and central light
  loadHdriBackground();
  setupCentralLight();
});

// Context-loss recovery: pause the simulation loop while the WebGL context is
// lost (the compositor owns the surface), mark shaders dirty so Three.js
// re-initializes them on restore, and notify the parent so the retry UI can
// remount if restoration fails.
let contextLost = false;

function onWebglContextLost(event: Event) {
  contextLost = true;
  event.preventDefault(); // opt out of the browser's "reload" recovery; we re-init on restore
  emitContextLost();
}

function onWebglContextRestored() {
  contextLost = false;
}

function emitContextLost() {
  // Forward to the parent GraveyardPage so it can also show the fallback /
  // auto-remount path already wired via @vue:error / onErrorCaptured.
  const el = renderer?.domElement;
  if (el) {
    el.dispatchEvent(new CustomEvent('void:context-lost', { bubbles: true, composed: true }));
  }
}

// Prevent the per-frame simulation from touching the dead context.
// Wrap the uTime advance in the loop so a lost context holds the last frame
// instead of throwing into the render pipeline.
function isContextLost(): boolean {
  return contextLost || renderer?.getContext()?.isContextLost?.() === true;
}

// Clean up listeners
const cleanupMouseListener = () => {
  if (renderer) {
    const canvas = renderer.domElement;
    canvas.removeEventListener('mousemove', onCanvasMouseMove);
    canvas.removeEventListener('mousedown', onCanvasMouseDown);
    canvas.removeEventListener('click', onCanvasClick);
    canvas.removeEventListener('webglcontextlost', onWebglContextLost as EventListener, false);
    canvas.removeEventListener(
      'webglcontextrestored',
      onWebglContextRestored as EventListener,
      false,
    );
  }
};

const cleanupKeyboardListeners = () => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
};

const cleanupPointerLockListeners = () => {
  document.removeEventListener('pointerlockchange', onPointerLockChange);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousedown', onMouseDownFpsExit);
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
onUnmounted(() => {
  sceneDisposed = true;
  if (hoverRaycastFrame !== null) cancelAnimationFrame(hoverRaycastFrame);
  hoverRaycastFrame = null;
  latestHoverEvent = null;
  sceneCleanup.splice(0).forEach((cleanup) => cleanup());
  cleanupMouseListener();
  cleanupKeyboardListeners();
  cleanupPointerLockListeners();
  coreMaterial.dispose();
  glowMaterial.dispose();
  beamCoreMaterial.dispose();
  beamGlowMaterial.dispose();
  if (scene.value?.background === backgroundTexture) scene.value.background = null;
  backgroundTexture?.dispose();
  backgroundTexture = null;
  if (beamCoreLines.value) {
    beamCoreLines.value.geometry.dispose();
  }
  if (beamGlowLines.value) {
    beamGlowLines.value.geometry.dispose();
  }
  if (centralLight.value && scene.value) {
    scene.value.remove(centralLight.value);
    centralLight.value.dispose();
  }
});
</script>
