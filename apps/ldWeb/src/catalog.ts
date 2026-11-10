import type { z } from 'zod';
import type { stationEntry } from './schemas';

export const genres = {
  general: '综合',
  pop: '流行',
  news: '新闻',
  rock: '摇滚',
  electronic: '电子',
  world: '世界音乐',
  religious: '宗教',
  classical: '古典',
  jazz: '爵士',
  folk: '民谣',
  hiphop: '嘻哈',
} as const;

const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const regionNamesEn = new Intl.DisplayNames(['en'], { type: 'region' });
const languageNames = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
export const normalize = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase();

export function languageName(code: string) {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function toStation(entry: z.infer<typeof stationEntry>) {
  const [
    id,
    name,
    countryCode,
    region,
    city,
    nearbyCity,
    latitude,
    longitude,
    precision,
    genre,
    languages,
    bitrate,
    availability,
  ] = entry;
  const country =
    countryCode === 'TW'
      ? '中国台湾'
      : countryCode
        ? (regionNames.of(countryCode) ?? countryCode)
        : '';
  const location =
    [...new Set([city, region, country].filter(Boolean))].join(' · ') || '地点未收录';
  return {
    id,
    name,
    countryCode,
    region,
    city,
    nearbyCity,
    latitude,
    longitude,
    precision,
    genre,
    languages,
    bitrate,
    availability,
    location,
    search: normalize(
      [
        name,
        city,
        nearbyCity,
        region,
        country,
        countryCode,
        countryCode === 'TW' ? 'China Taiwan CN' : countryCode ? regionNamesEn.of(countryCode) : '',
        genres[genre],
        genre,
        ...languages,
        ...languages.map(languageName),
      ].join(' '),
    ),
    cityKey:
      city && countryCode ? `${countryCode}:${normalize(region ?? '')}:${normalize(city)}` : '',
  };
}
export type Station = ReturnType<typeof toStation>;
