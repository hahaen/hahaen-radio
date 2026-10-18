const aliases: Record<string, string> = {
  英语: 'en',
  中文: 'zh',
  汉语: 'zh',
  德语: 'de',
  法语: 'fr',
  西班牙语: 'es',
  葡萄牙语: 'pt',
  俄语: 'ru',
  日语: 'ja',
  韩语: 'ko',
  english: 'en',
  eng: 'en',
  'british english': 'en',
  'american english': 'en',
  'english uk': 'en',
  'en gb': 'en',
  engilsh: 'en',
  egnlish: 'en',
  chinese: 'zh',
  mandarin: 'zh',
  cmn: 'zh',
  普通话: 'zh',
  国语: 'zh',
  cantonese: 'yue',
  cantonce: 'yue',
  广东话: 'yue',
  german: 'de',
  deutsch: 'de',
  deu: 'de',
  ger: 'de',
  deutch: 'de',
  gernan: 'de',
  french: 'fr',
  français: 'fr',
  francaise: 'fr',
  fre: 'fr',
  fench: 'fr',
  spanish: 'es',
  español: 'es',
  castellano: 'es',
  spa: 'es',
  espanish: 'es',
  portuguese: 'pt',
  português: 'pt',
  por: 'pt',
  'brazilian portuguese': 'pt-BR',
  'português (brasil)': 'pt-BR',
  'português (br)': 'pt-BR',
  'português brasil': 'pt-BR',
  'portugues brasil': 'pt-BR',
  'portugues do brasil': 'pt-BR',
  russian: 'ru',
  русский: 'ru',
  rus: 'ru',
  'язык: русский': 'ru',
  italian: 'it',
  italiano: 'it',
  ita: 'it',
  japanese: 'ja',
  jpn: 'ja',
  korean: 'ko',
  arabic: 'ar',
  ara: 'ar',
  hindi: 'hi',
  hin: 'hi',
  dutch: 'nl',
  nederlands: 'nl',
  duits: 'de',
  greek: 'el',
  gre: 'el',
  turkish: 'tr',
  türkçe: 'tr',
  tur: 'tr',
  ukrainian: 'uk',
  ukranian: 'uk',
  polish: 'pl',
  pol: 'pl',
  romanian: 'ro',
  română: 'ro',
  româna: 'ro',
  swedish: 'sv',
  norwegian: 'no',
  norsk: 'no',
  danish: 'da',
  dan: 'da',
  finnish: 'fi',
  suomi: 'fi',
  hungarian: 'hu',
  hun: 'hu',
  czech: 'cs',
  česky: 'cs',
  čeština: 'cs',
  slovak: 'sk',
  slovenski: 'sl',
  hebrew: 'he',
  heb: 'he',
  indonesian: 'id',
  'bahasa indonesia': 'id',
  filipino: 'fil',
  tagalog: 'tl',
  vietnamese: 'vi',
  thai: 'th',
  persian: 'fa',
  farsi: 'fa',
  bengali: 'bn',
  bangla: 'bn',
  punjabi: 'pa',
  tamil: 'ta',
  telugu: 'te',
  swahili: 'sw',
  kiswahili: 'sw',
};
const cache = new Map<string, string | null>();
const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
export function normalizeLanguage(value: string): string | null {
  const key = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (cache.has(key)) return cache.get(key)!;
  let result: string | null = null;
  if (Object.hasOwn(aliases, key)) result = aliases[key]!;
  else if (
    !['pop', 'rap', 'mix', 'all', 'mis', 'und', 'mul'].includes(key) &&
    /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(key)
  ) {
    try {
      const canonical = Intl.getCanonicalLocales(key)[0];
      if (canonical && names.of(canonical)) result = canonical;
    } catch {
      /* Unknown language labels have no canonical match. */
    }
  }
  if (cache.size < 2048) cache.set(key, result);
  return result;
}
export function normalizeLanguages(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeLanguage).filter((v): v is string => v !== null))];
}
/** Match canonical filters against older catalogue snapshots during rolling updates. */
export function languageFilterAliases(values: readonly string[]): string[] {
  const canonical = new Set(normalizeLanguages(values));
  return [
    ...new Set([
      ...values.filter((value) => normalizeLanguage(value) !== null),
      ...canonical,
      ...[...canonical].map((code) => code.toLowerCase()),
      ...Object.keys(aliases).filter((key) => canonical.has(aliases[key]!)),
    ]),
  ];
}
