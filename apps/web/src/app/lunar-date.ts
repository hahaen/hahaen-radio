const months = '正月 二月 三月 四月 五月 六月 七月 八月 九月 十月 冬月 腊月'.split(' ');
const days = (
  '初一 初二 初三 初四 初五 初六 初七 初八 初九 初十 ' +
  '十一 十二 十三 十四 十五 十六 十七 十八 十九 二十 ' +
  '廿一 廿二 廿三 廿四 廿五 廿六 廿七 廿八 廿九 三十'
).split(' ');

export function createLunarFormatter() {
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      calendar: 'chinese',
      numberingSystem: 'latn',
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
    });
    return formatter.resolvedOptions().calendar === 'chinese' ? formatter : null;
  } catch {
    return null;
  }
}

export function lunarDate(formatter: Intl.DateTimeFormat | null, now: number) {
  const parts = formatter?.formatToParts(now);
  const monthPart = parts?.find((part) => part.type === 'month')?.value;
  const day = Number(parts?.find((part) => part.type === 'day')?.value);
  const match = monthPart?.match(/^(闰)?(\d{1,2})$/);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 30)
    return null;
  const leap = !!match[1];
  return {
    month,
    day,
    leap,
    date: `${leap ? '闰' : ''}${months[month - 1]}${days[day - 1]}`,
  };
}
