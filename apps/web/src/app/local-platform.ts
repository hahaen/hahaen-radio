import type { StationDetail, StationPreview } from '@haen/contracts';
import type { PlayerOptions } from '../audio/controller';
import type { SceneCatalog } from '../catalog/load';
import type { Library } from '../library/store';

export interface LocalPlatform {
  loadCatalog(
    signal: AbortSignal,
    onProgress: (loaded: number, total: number) => void,
  ): Promise<SceneCatalog>;
  player: PlayerOptions;
  canPlay(station: StationPreview, detail?: StationDetail | null): boolean;
  isCandidate(id: string): boolean;
  lookup(
    ids: readonly string[],
    signal: AbortSignal,
  ): Promise<{ items: StationDetail[]; missing: string[] }>;
  createLibrary(): Library;
  setLanguage(value: 'zh' | 'en'): Promise<boolean>;
}

const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase();

export function stationCityKey(station: StationPreview) {
  const place = station.city ?? station.nearbyCity;
  return station.countryCode && place
    ? JSON.stringify([station.countryCode, normalize(station.region ?? ''), normalize(place)])
    : null;
}
