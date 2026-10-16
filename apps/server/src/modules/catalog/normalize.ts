import { createHash } from 'node:crypto';
import { validateRemoteUrl } from '../../integrations/public-http.js';
import { z } from 'zod';
import {
  StationDetailSchema,
  type Genre,
  type StationDetail,
  type StreamCandidate,
} from '@haen/contracts';

const RawStationSchema = z.object({
  stationuuid: z.uuid(),
  name: z.string().max(2048),
  url: z.string().max(8192).default(''),
  url_resolved: z.string().max(8192).default(''),
  homepage: z.string().max(8192).default(''),
  countrycode: z.string().max(16).default(''),
  state: z.string().max(2048).default(''),
  tags: z.string().max(16384).default(''),
  language: z.string().max(8192).default(''),
  languagecodes: z.string().max(8192).default(''),
  codec: z.string().max(128).default(''),
  bitrate: z.number().finite().nonnegative().default(0),
  hls: z.union([z.literal(0), z.literal(1), z.boolean()]).default(0),
  lastcheckok: z.union([z.literal(0), z.literal(1), z.boolean()]).default(0),
  geo_lat: z.union([z.number(), z.string().max(64), z.null()]).optional(),
  geo_long: z.union([z.number(), z.string().max(64), z.null()]).optional(),
});

const languageCodes: Record<string, string> = {
  english: 'en',
  chinese: 'zh',
  mandarin: 'zh',
  german: 'de',
  french: 'fr',
  spanish: 'es',
  portuguese: 'pt',
  russian: 'ru',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  arabic: 'ar',
  hindi: 'hi',
  dutch: 'nl',
  greek: 'el',
  turkish: 'tr',
  ukrainian: 'uk',
  polish: 'pl',
  cantonese: 'yue',
};
const genreRules: [Genre, RegExp][] = [
  ['news', /news|talk|speech|新闻|谈话/],
  ['classical', /classical|opera|古典/],
  ['jazz', /jazz|blues|爵士|蓝调/],
  ['hiphop', /hip.?hop|rap|嘻哈/],
  ['religious', /religio|christian|gospel|islam|quran|宗教/],
  ['electronic', /electro|techno|trance|house|dance|ambient|电子/],
  ['rock', /rock|metal|punk|alternative|摇滚/],
  ['folk', /country|folk|bluegrass|乡村|民谣/],
  ['world', /world|regional|local|民族|地方/],
  ['pop', /pop|hits|top.?40|流行/],
];
const clean = (value: string, length: number) =>
  [...value]
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character,
    )
    .join('')
    .trim()
    .slice(0, length);
const split = (value: string, limit: number) =>
  [
    ...new Set(
      value
        .split(/[,;]+/)
        .map((item) => clean(item, 64).toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, limit);

export function publicHttpsUrl(value: string): string | null {
  try {
    const url = validateRemoteUrl(value);
    if (url.protocol !== 'https:' || url.username || url.password || value.length > 4096)
      return null;
    if (
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.local')
    )
      return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
function coordinate(value: number | string | null | undefined, min: number, max: number) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim()))
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
export function normalizeStation(input: unknown): StationDetail | null {
  const parsed = RawStationSchema.safeParse(input);
  if (!parsed.success) return null;
  const raw = parsed.data;
  const name = clean(raw.name, 512);
  if (!name) return null;
  const urls = [
    ...new Set(
      [raw.url_resolved, raw.url]
        .map(publicHttpsUrl)
        .filter((value): value is string => value !== null),
    ),
  ];
  const roundedBitrate = Math.round(raw.bitrate);
  const bitrate = roundedBitrate >= 1 && roundedBitrate <= 10000 ? roundedBitrate : null;
  const streams: StreamCandidate[] = urls.slice(0, 3).map((url) => ({
    id: createHash('sha256').update(url).digest('hex').slice(0, 24),
    url,
    hls: Boolean(raw.hls) || /\.m3u8(?:[?]|$)/i.test(url),
    codec: clean(raw.codec, 32) || null,
    bitrate,
    analysis: 'unknown',
  }));
  const countryCode = /^[a-z]{2}$/i.test(raw.countrycode) ? raw.countrycode.toUpperCase() : null;
  const lat = coordinate(raw.geo_lat, -90, 90),
    lon = coordinate(raw.geo_long, -180, 180);
  const hasCoordinates = lat !== null && lon !== null;
  const tags = split(raw.tags, 64);
  const languages = split(raw.languagecodes || raw.language, 32).map(
    (language) => languageCodes[language] ?? language,
  );
  return StationDetailSchema.parse({
    id: raw.stationuuid.toLowerCase(),
    name,
    countryCode,
    region: clean(raw.state, 255) || null,
    city: null,
    nearbyCity: null,
    latitude: hasCoordinates ? lat : null,
    longitude: hasCoordinates ? lon : null,
    locationPrecision: hasCoordinates ? 'coordinates' : countryCode ? 'country' : 'unknown',
    timezone: null,
    timezoneSource: null,
    genre: genreRules.find(([, rule]) => tags.some((tag) => rule.test(tag)))?.[0] ?? 'general',
    tags,
    languages: [...new Set(languages)],
    bitrate,
    availability: raw.lastcheckok && streams.length ? 'available' : 'unavailable',
    homepage: publicHttpsUrl(raw.homepage),
    streams,
  });
}
