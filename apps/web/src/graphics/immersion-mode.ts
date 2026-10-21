import type { Genre } from '@haen/contracts';
import type { ImmersionEffect, SceneOptions } from '../library/model';

export function immersionMode(effect: SceneOptions['immersion'], genre?: Genre): ImmersionEffect {
  if (effect !== 'auto') return effect;
  if (genre === 'classical' || genre === 'folk') return 'dunes';
  if (genre === 'world' || genre === 'religious') return 'ocean';
  return 'aurora';
}
