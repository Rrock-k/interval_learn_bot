import dayjs from 'dayjs';

export type OneTimePreset = 'hour' | 'evening' | 'morning';

const UNIT_TO_DAYJS_UNIT = new Map<string, dayjs.ManipulateType>([
  ['мин', 'minute'],
  ['минута', 'minute'],
  ['минуту', 'minute'],
  ['минуты', 'minute'],
  ['минут', 'minute'],
  ['ч', 'hour'],
  ['час', 'hour'],
  ['часа', 'hour'],
  ['часов', 'hour'],
  ['д', 'day'],
  ['день', 'day'],
  ['дня', 'day'],
  ['дней', 'day'],
  ['неделя', 'week'],
  ['неделю', 'week'],
  ['недели', 'week'],
  ['недель', 'week'],
  ['месяц', 'month'],
  ['месяца', 'month'],
  ['месяцев', 'month'],
]);

export const computeOneTimeReminderAt = (
  preset: OneTimePreset,
  now = dayjs(),
): string => {
  if (preset === 'hour') {
    return now.add(1, 'hour').toISOString();
  }
  if (preset === 'evening') {
    let target = now.hour(20).minute(0).second(0).millisecond(0);
    if (!target.isAfter(now)) {
      target = target.add(1, 'day');
    }
    return target.toISOString();
  }
  return now.add(1, 'day').hour(10).minute(0).second(0).millisecond(0).toISOString();
};

export const parseOneTimeReminderText = (
  input: string,
  now = dayjs(),
): string | null => {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;

  if (text === 'вечером' || text === 'сегодня вечером') {
    return computeOneTimeReminderAt('evening', now);
  }
  if (text === 'завтра' || text === 'завтра утром') {
    return computeOneTimeReminderAt('morning', now);
  }
  if (text === 'послезавтра') {
    return now.add(2, 'day').hour(10).minute(0).second(0).millisecond(0).toISOString();
  }

  const relative = text.match(/^через\s+(?:(\d+)\s*)?([а-яёa-z.]+)$/i);
  if (relative) {
    const amount = relative[1] ? Number(relative[1]) : 1;
    const unitRaw = relative[2]?.replace(/\.$/, '') ?? '';
    const unit = UNIT_TO_DAYJS_UNIT.get(unitRaw);
    if (Number.isInteger(amount) && amount > 0 && unit) {
      return now.add(amount, unit).toISOString();
    }
  }

  const tomorrowTime = text.match(/^завтра\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?$/);
  if (tomorrowTime) {
    const parsed = buildDateWithTime(now.add(1, 'day'), tomorrowTime[1], tomorrowTime[2]);
    return parsed?.toISOString() ?? null;
  }

  const todayTime = text.match(/^(?:сегодня\s+)?(?:в\s+)?(\d{1,2})(?::(\d{2}))?$/);
  if (todayTime) {
    let parsed = buildDateWithTime(now, todayTime[1], todayTime[2]);
    if (parsed && !parsed.isAfter(now)) {
      parsed = parsed.add(1, 'day');
    }
    return parsed?.toISOString() ?? null;
  }

  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?)?$/);
  if (isoDate) {
    const parsed = buildDate(
      Number(isoDate[1]),
      Number(isoDate[2]),
      Number(isoDate[3]),
      isoDate[4],
      isoDate[5],
    );
    return parsed && parsed.isAfter(now) ? parsed.toISOString() : null;
  }

  const dottedDate = text.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?:\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?)?$/);
  if (dottedDate) {
    const yearRaw = dottedDate[3] ? Number(dottedDate[3]) : now.year();
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    let parsed = buildDate(
      year,
      Number(dottedDate[2]),
      Number(dottedDate[1]),
      dottedDate[4],
      dottedDate[5],
    );
    if (parsed && !dottedDate[3] && !parsed.isAfter(now)) {
      parsed = parsed.add(1, 'year');
    }
    return parsed && parsed.isAfter(now) ? parsed.toISOString() : null;
  }

  return null;
};

const buildDateWithTime = (
  date: dayjs.Dayjs,
  hoursRaw: string | undefined,
  minutesRaw: string | undefined,
) => {
  const hours = Number(hoursRaw);
  const minutes = minutesRaw ? Number(minutesRaw) : 0;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return date.hour(hours).minute(minutes).second(0).millisecond(0);
};

const buildDate = (
  year: number,
  month: number,
  day: number,
  hoursRaw: string | undefined,
  minutesRaw: string | undefined,
) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const base = dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`);
  if (!base.isValid() || base.year() !== year || base.month() + 1 !== month || base.date() !== day) {
    return null;
  }
  return buildDateWithTime(base, hoursRaw ?? '10', minutesRaw);
};
