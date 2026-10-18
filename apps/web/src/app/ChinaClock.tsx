import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createLunarFormatter, lunarDate } from './lunar-date';
import styles from './App.module.css';

export function ChinaClock() {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const formatters = useMemo(() => {
    const locale = i18n.language === 'en' ? 'en-GB' : 'zh-CN';
    return {
      time: new Intl.DateTimeFormat(locale, {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
      date: new Intl.DateTimeFormat(locale, {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }),
      lunar: createLunarFormatter(),
    };
  }, [i18n.language]);
  const lunar = lunarDate(formatters.lunar, now);

  useEffect(() => {
    const refresh = () => {
      clearTimeout(timer);
      setNow(Date.now());
      timer = setTimeout(refresh, 60000 - (Date.now() % 60000));
    };
    let timer = setTimeout(refresh, 60000 - (Date.now() % 60000));
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return (
    <time className={styles.chinaClock} dateTime={new Date(now).toISOString()}>
      <span className={styles.clockTime}>{formatters.time.format(now)}</span>
      <span className={styles.clockDate}>
        <span>
          {t('chinaTime')} · {formatters.date.format(now)}
        </span>
        {lunar && <span>{t(lunar.leap ? 'lunarLeapDate' : 'lunarDate', lunar)}</span>}
      </span>
    </time>
  );
}
