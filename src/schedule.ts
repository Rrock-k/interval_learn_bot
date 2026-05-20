import dayjs from 'dayjs';

// --- Types ---

export type ScheduleRule =
  | { type: 'days'; interval: number; timeMinutes?: number }
  | { type: 'months'; interval: number; timeMinutes?: number }
  | { type: 'years'; interval: number; timeMinutes?: number }
  | { type: 'weekdays'; days: number[]; timeMinutes?: number } // 1=Пн..7=Вс
  | { type: 'annual_date'; month: number; day: number; timeMinutes?: number };

// --- Presets (used in bot keyboards) ---

export interface SchedulePreset {
  code: string;
  label: string;
  rule: ScheduleRule;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { code: 'd1', label: 'Каждый день', rule: { type: 'days', interval: 1 } },
  { code: 'd2', label: 'Через день', rule: { type: 'days', interval: 2 } },
  { code: 'd7', label: 'Каждую неделю', rule: { type: 'days', interval: 7 } },
  { code: 'm1', label: 'Каждый месяц', rule: { type: 'months', interval: 1 } },
  { code: 'y1', label: 'Каждый год', rule: { type: 'years', interval: 1 } },
];

export const PRESET_BY_CODE = new Map(SCHEDULE_PRESETS.map((p) => [p.code, p]));

// --- Weekday helpers ---

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
  7: 'Вс',
};

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const weekdayLabel = (day: number): string => WEEKDAY_LABELS[day] ?? '?';

export const formatWeekdays = (days: number[]): string =>
  [...days].sort((a, b) => a - b).map(weekdayLabel).join(', ');

// --- Compute next date from schedule ---

export const computeNextFromSchedule = (
  rule: ScheduleRule,
  after: dayjs.Dayjs = dayjs(),
): string => {
  const now = after.second(0).millisecond(0);

  switch (rule.type) {
    case 'days':
      return computeNextInterval(now, rule.interval, 'day', rule.timeMinutes).toISOString();

    case 'months':
      return computeNextInterval(now, rule.interval, 'month', rule.timeMinutes).toISOString();

    case 'years':
      return computeNextInterval(now, rule.interval, 'year', rule.timeMinutes).toISOString();

    case 'weekdays':
      return computeNextWeekday(now, rule.days, rule.timeMinutes).toISOString();

    case 'annual_date':
      return computeNextAnnualDate(now, rule.month, rule.day, rule.timeMinutes).toISOString();
  }
};

const applyTime = (date: dayjs.Dayjs, timeMinutes: number | undefined): dayjs.Dayjs => {
  if (!Number.isInteger(timeMinutes)) {
    return date;
  }
  const clamped = Math.min(1439, Math.max(0, timeMinutes ?? 0));
  return date.hour(Math.floor(clamped / 60)).minute(clamped % 60).second(0).millisecond(0);
};

const computeNextInterval = (
  now: dayjs.Dayjs,
  interval: number,
  unit: dayjs.ManipulateType,
  timeMinutes: number | undefined,
): dayjs.Dayjs => {
  if (Number.isInteger(timeMinutes)) {
    const todayAtTime = applyTime(now, timeMinutes);
    if (todayAtTime.isAfter(now)) {
      return todayAtTime;
    }
  }
  return applyTime(now.add(Math.max(1, interval), unit), timeMinutes);
};

const computeNextWeekday = (
  now: dayjs.Dayjs,
  weekdays: number[],
  timeMinutes: number | undefined,
): dayjs.Dayjs => {
  if (!weekdays.length) return now.add(1, 'day');

  const sorted = [...weekdays].sort((a, b) => a - b);
  // dayjs .day(): 0=Sun, 1=Mon...6=Sat → convert to ISO: 1=Mon..7=Sun
  const todayIso = now.day() === 0 ? 7 : now.day();

  for (const wd of sorted) {
    if (wd >= todayIso) {
      const diff = wd - todayIso;
      const candidate = applyTime(now.add(diff, 'day'), timeMinutes);
      if (candidate.isAfter(now)) {
        return candidate;
      }
    }
  }
  // All weekdays ≤ today → go to next week's first weekday
  const diff = 7 - todayIso + (sorted[0] ?? 1);
  return applyTime(now.add(diff, 'day'), timeMinutes);
};

const computeNextAnnualDate = (
  now: dayjs.Dayjs,
  month: number,
  day: number,
  timeMinutes: number | undefined,
): dayjs.Dayjs => {
  const build = (year: number) =>
    applyTime(
      dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`),
      timeMinutes ?? 9 * 60,
    );
  let candidate = build(now.year());
  if (!candidate.isValid() || candidate.month() + 1 !== month || candidate.date() !== day) {
    candidate = build(now.year() + 1);
  }
  if (!candidate.isAfter(now)) {
    candidate = build(now.year() + 1);
  }
  return candidate;
};

// --- Serialize / parse ---

export const serializeScheduleRule = (rule: ScheduleRule): string =>
  JSON.stringify(rule);

export const parseScheduleRule = (raw: string | null): ScheduleRule | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.type === 'string') {
      return parsed as ScheduleRule;
    }
  } catch {
    // ignore
  }
  return null;
};

// --- Natural language parser (Russian) ---

const WEEKDAY_NAMES: Record<string, number> = {
  // full forms
  'понедельник': 1, 'вторник': 2, 'среда': 3, 'среду': 3,
  'четверг': 4, 'пятница': 5, 'пятницу': 5,
  'суббота': 6, 'субботу': 6, 'воскресенье': 7, 'воскресенью': 7,
  // short forms
  'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 7,
  // dative plural ("по понедельникам")
  'понедельникам': 1, 'вторникам': 2, 'средам': 3,
  'четвергам': 4, 'пятницам': 5, 'субботам': 6, 'воскресеньям': 7,
};

const extractNumber = (text: string): number | null => {
  const m = text.match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

/**
 * Parse Russian natural-language schedule description into a ScheduleRule.
 * Returns null if the text is not recognized.
 *
 * Supported patterns:
 *   "каждый день", "ежедневно"
 *   "через день"
 *   "каждые 3 дня", "раз в 5 дней"
 *   "каждую неделю", "еженедельно"
 *   "раз в 2 недели", "каждые 2 недели"
 *   "каждый месяц", "ежемесячно", "раз в 3 месяца"
 *   "каждый год", "ежегодно", "раз в 2 года"
 *   "пн, ср, пт", "по понедельникам и средам"
 *   "каждый понедельник", "каждую среду и пятницу"
 */
export const parseNaturalSchedule = (input: string): ScheduleRule | null => {
  const text = input.toLowerCase().trim();
  if (!text) return null;

  // --- Fixed phrases ---
  if (/(^|\s)(каждый день|ежедневно)(\s|$)/.test(text)) {
    return { type: 'days', interval: 1 };
  }
  if (/(^|\s)через день(\s|$)/.test(text)) {
    return { type: 'days', interval: 2 };
  }
  if (/(^|\s)(каждую неделю|еженедельно|через неделю)(\s|$)/.test(text)) {
    return { type: 'days', interval: 7 };
  }
  if (/(^|\s)(каждый месяц|ежемесячно|через месяц)(\s|$)/.test(text)) {
    return { type: 'months', interval: 1 };
  }
  if (/(^|\s)(каждый год|ежегодно|через год)(\s|$)/.test(text)) {
    return { type: 'years', interval: 1 };
  }

  // --- "каждые N дней" / "раз в N дней" / "через N дней" ---
  {
    const m = text.match(/(?:кажд[а-яё]*|раз\s+в|через)\s+(\d+)\s*(дн|ден|день)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1) return { type: 'days', interval: n };
    }
  }

  // --- "каждые N недель" / "раз в N недель" / "через N недель" ---
  {
    const m = text.match(/(?:кажд[а-яё]*|раз\s+в|через)\s+(\d+)\s*недел/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1) return { type: 'days', interval: n * 7 };
    }
  }

  // --- "раз в неделю" (without number) ---
  if (/раз\s+в\s+недел/.test(text)) {
    return { type: 'days', interval: 7 };
  }

  // --- "каждые N месяцев" / "раз в N месяцев" / "через N месяцев" ---
  {
    const m = text.match(/(?:кажд[а-яё]*|раз\s+в|через)\s+(\d+)\s*месяц/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1) return { type: 'months', interval: n };
    }
  }

  // --- "раз в месяц" ---
  if (/раз\s+в\s+месяц/.test(text)) {
    return { type: 'months', interval: 1 };
  }

  // --- "каждые N лет" / "раз в N лет" / "через N лет" ---
  {
    const m = text.match(/(?:кажд[а-яё]*|раз\s+в|через)\s+(\d+)\s*(год|лет)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1) return { type: 'years', interval: n };
    }
  }

  // --- "раз в год" ---
  if (/раз\s+в\s+год/.test(text)) {
    return { type: 'years', interval: 1 };
  }

  // --- "по будням" / "по выходным" ---
  if (/(?:^|\s)(будн|по\s+будн)/.test(text)) {
    return { type: 'weekdays', days: [1, 2, 3, 4, 5] };
  }
  if (/(?:^|\s)(выходн|по\s+выходн)/.test(text)) {
    return { type: 'weekdays', days: [6, 7] };
  }

  // --- Weekdays: extract all day names from text ---
  const foundDays = extractWeekdays(text);
  if (foundDays.length > 0) {
    return { type: 'weekdays', days: foundDays };
  }

  return null;
};

const extractWeekdays = (text: string): number[] => {
  const days = new Set<number>();

  // Try matching each known weekday name in the text
  for (const [name, day] of Object.entries(WEEKDAY_NAMES)) {
    // Word boundary: match the name preceded and followed by non-letter chars (or start/end)
    const re = new RegExp(`(?:^|[^а-яё])${name}(?:[^а-яё]|$)`);
    if (re.test(text)) {
      days.add(day);
    }
  }

  return [...days].sort((a, b) => a - b);
};

// --- Human-readable label ---

export const formatTimeMinutes = (timeMinutes: number | undefined): string | null => {
  if (!Number.isInteger(timeMinutes)) return null;
  const clamped = Math.min(1439, Math.max(0, timeMinutes ?? 0));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
};

const withTimeLabel = (label: string, timeMinutes: number | undefined): string => {
  const time = formatTimeMinutes(timeMinutes);
  return time ? `${label} в ${time}` : label;
};

export const scheduleRuleLabel = (rule: ScheduleRule): string => {
  switch (rule.type) {
    case 'days': {
      const preset = SCHEDULE_PRESETS.find(
        (p) => p.rule.type === 'days' && p.rule.interval === rule.interval,
      );
      if (preset) return withTimeLabel(preset.label, rule.timeMinutes);
      return withTimeLabel(`Каждые ${rule.interval} дн.`, rule.timeMinutes);
    }
    case 'months':
      if (rule.interval === 1) return withTimeLabel('Каждый месяц', rule.timeMinutes);
      return withTimeLabel(`Каждые ${rule.interval} мес.`, rule.timeMinutes);
    case 'years':
      if (rule.interval === 1) return withTimeLabel('Каждый год', rule.timeMinutes);
      return withTimeLabel(`Каждые ${rule.interval} г.`, rule.timeMinutes);
    case 'weekdays':
      return withTimeLabel(formatWeekdays(rule.days), rule.timeMinutes);
    case 'annual_date':
      return withTimeLabel(
        `Каждый год ${String(rule.day).padStart(2, '0')}.${String(rule.month).padStart(2, '0')}`,
        rule.timeMinutes ?? 9 * 60,
      );
  }
};
