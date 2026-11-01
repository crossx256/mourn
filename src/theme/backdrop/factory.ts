import type { BackdropPrefs } from '../preferences';
import type { BackdropPattern } from './types';
import { StaticDots } from './dots';
import { Synapse } from './patterns/synapse';
import { Rain } from './patterns/rain';
import { Constellations } from './patterns/constellations';
import { PerlinFlow } from './patterns/perlin-flow';
import { Petals } from './patterns/petals';
import { Sparkles } from './patterns/sparkles';
import { Embers } from './patterns/embers';

export function createBackdropPattern(options: BackdropPrefs): BackdropPattern | null {
  switch (options.pattern) {
    case 'dots':
      return new StaticDots();
    case 'synapse':
      return new Synapse();
    case 'rain':
      return new Rain();
    case 'constellations':
      return new Constellations();
    case 'perlin-flow':
      return new PerlinFlow();
    case 'petals':
      return new Petals();
    case 'sparkles':
      return new Sparkles();
    case 'embers':
      return new Embers();
    default:
      return null;
  }
}
