import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeLanguages, type StationDetail, type StationPreview } from '@haen/contracts';
import styles from './App.module.css';
import { mapPosition } from '../graphics/location';
function LocalTime({ zone }: { zone: string }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const formatter = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'zh-CN', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return null;
    }
  }, [zone, i18n.language]);
  useEffect(() => {
    if (!formatter) return;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [formatter]);
  return formatter ? (
    <div className={styles.timeFact}>
      <dt>{t('localTime')}</dt>
      <dd>
        <time dateTime={new Date(now).toISOString()} title={t('timezoneEvidence')}>
          {formatter.format(now)}
        </time>
      </dd>
    </div>
  ) : null;
}
export function StationFacts({
  station,
  detail,
}: {
  station: StationPreview;
  detail: StationDetail | null;
}) {
  const { t, i18n } = useTranslation();
  const names = useMemo(
    () => new Intl.DisplayNames([i18n.language === 'en' ? 'en' : 'zh-CN'], { type: 'language' }),
    [i18n.language],
  );
  const language = (code: string) => {
    try {
      return names.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const languages = normalizeLanguages(station.languages);
  const position = mapPosition(station);
  return (
    <dl className={styles.facts}>
      {station.locationPrecision === 'coordinates' &&
        station.latitude !== null &&
        station.longitude !== null && (
          <div className={styles.coordinateFact}>
            <dt>{t('coordinates')}</dt>
            <dd>
              {Math.abs(station.latitude).toFixed(4)}° {station.latitude < 0 ? 'S' : 'N'}
              <br />
              {Math.abs(station.longitude).toFixed(4)}° {station.longitude < 0 ? 'W' : 'E'}
            </dd>
          </div>
        )}
      {position?.precision === 'country' && (
        <div className={styles.coordinateFact}>
          <dt>{t('mapLocation')}</dt>
          <dd title={t('countryMapHint')}>{t('countryLocation')}</dd>
        </div>
      )}
      <div>
        <dt>{t('stationLanguages')}</dt>
        <dd>{languages.length ? languages.map(language).join(' / ') : t('unknownLanguage')}</dd>
      </div>
      {detail?.timezone && detail.timezoneSource === 'geonames' && (
        <LocalTime key={detail.id + detail.timezone} zone={detail.timezone} />
      )}
    </dl>
  );
}

export function StationClock({ detail }: { detail: StationDetail | null }) {
  const { t } = useTranslation();
  return detail?.timezone && detail.timezoneSource === 'geonames' ? (
    <dl className={styles.stationClock}>
      <LocalTime key={detail.id + detail.timezone} zone={detail.timezone} />
    </dl>
  ) : (
    <span className={styles.clockUnavailable}>{t('localTime')} · —</span>
  );
}
