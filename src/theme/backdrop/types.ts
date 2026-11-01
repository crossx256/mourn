import type { BackdropPrefs } from '../preferences';

export interface CanvasContextLike {
  clearRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
}

export interface CanvasLike {
  id: string;
  width: number;
  height: number;
  style: { width?: string; height?: string };
  getContext(type: '2d'): CanvasContextLike | null;
}

export interface BackdropMediaQueryLike {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: EventListener): void;
  removeEventListener(type: 'change', listener: EventListener): void;
}

export interface BackdropWindowLike {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  matchMedia(query: string): BackdropMediaQueryLike;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface BackdropDocumentLike {
  visibilityState: string;
  hasFocus(): boolean;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface BackdropDependencies {
  now(): number;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  window: BackdropWindowLike;
  document: BackdropDocumentLike;
  mobile?: boolean;
}

export interface BackdropMetrics {
  frames: number;
  measuredSteps: number;
  lastStepMs: number;
  medianStepMs: number;
  p95StepMs: number;
  targetStepMs: 1.5;
  particleCount: number;
  dpr: number;
}

export interface BackdropPattern {
  init(context: CanvasContextLike): void;
  resize(width: number, height: number, dpr: number, options: BackdropPrefs, mobile: boolean): void;
  step(context: CanvasContextLike, elapsedMs: number): void;
  destroy(): void;
  readonly particleCount: number;
}
