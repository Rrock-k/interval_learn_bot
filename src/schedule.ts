import dayjs from 'dayjs';

// --- Types ---

export type ScheduleRule =
  | { type: 'days'; interval: number }
  | { type: 'months'; interval: number }
  | { type: 'years'; interval: number }
  | { type: 'weekdays'; days: number[] }; // 1=Пн..7=Вс

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

export const computeNextFromSchedule = (rule: ScheduleRule): string => {
  const now = dayjs();

  switch (rule.type) {
    case 'days':
      return now.add(rule.interval, 'day').toISOString();

    case 'months':
      return now.add(rule.interval, 'month').toISOString();

    case 'years':
      return now.add(rule.interval, 'year').toISOString();

    case 'weekdays':
      return computeNextWeekday(now, rule.days).toISOString();
  }
};

const computeNextWeekday = (now: dayjs.Dayjs, weekdays: number[]): dayjs.Dayjs => {
  if (!weekdays.length) return now.add(1, 'day');

  const sorted = [...weekdays].sort((a, b) => a - b);
  // dayjs .day(): 0=Sun, 1=Mon...6=Sat → convert to ISO: 1=Mon..7=Sun
  const todayIso = now.day() === 0 ? 7 : now.day();

  for (const wd of sorted) {
    if (wd > todayIso) {
      const diff = wd - todayIso;
      return now.add(diff, 'day');
    }
  }
  // All weekdays ≤ today → go to next week's first weekday
  const diff = 7 - todayIso + (sorted[0] ?? 1);
  return now.add(diff, 'day');
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
  if (/^(каждый день|ежедневно)$/.test(text)) {
    return { type: 'days', interval: 1 };
  }
  if (/^через день$/.test(text)) {
    return { type: 'days', interval: 2 };
  }
  if (/^(каждую неделю|еженедельно)$/.test(text)) {
    return { type: 'days', interval: 7 };
  }
  if (/^(каждый месяц|ежемесячно)$/.test(text)) {
    return { type: 'months', interval: 1 };
  }
  if (/^(каждый год|ежегодно)$/.test(text)) {
    return { type: 'years', interval: 1 };
  }

  // --- "каждые N дней/дня/день" ---
  if (/кажд\w*\s+(\d+)\s*(дн|ден|день)/.test(text)) {
    const n = extractNumber(text);
    if (n && n >= 1) return { type: 'days', interval: n };
  }

  // --- "раз в N дней" ---
  if (/раз\s+в\s+(\d+)\s*(дн|ден|день)/.test(text)) {
    const n = extractNumber(text);
    if (n && n >= 1) return { type: 'days', interval: n };
  }

  // --- "каждые N недель / раз в N недель" ---
  {
    const m = text.match(/(?:кажд\w*|раз\s+в)\s+(\d+)\s*недел/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1) return { type: 'days', interval: n * 7 };
    }
  }

  // --- "раз в неделю" (without number) ---
  if (/раз\s+в\s+недел/.test(text)) {
    return { type: 'days', interval: 7 };
  }

  // --- "каждые N месяцев / раз в N месяцев" ---
  {
    const m = text.match(/(?:кажд\w*|раз\s+в)\s+(\d+)\s*месяц/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1) return { type: 'months', interval: n };
    }
  }

  // --- "раз в месяц" ---
  if (/раз\s+в\s+месяц/.test(text)) {
    return { type: 'months', interval: 1 };
  }

  // --- "каждые N лет / раз в N лет / года" ---
  {
    const m = text.match(/(?:кажд\w*|раз\s+в)\s+(\d+)\s*(год|лет)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1) return { type: 'years', interval: n };
    }
  }

  // --- "раз в год" ---
  if (/раз\s+в\s+год/.test(text)) {
    return { type: 'years', interval: 1 };
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

export const scheduleRuleLabel = (rule: ScheduleRule): string => {
  switch (rule.type) {
    case 'days': {
      const preset = SCHEDULE_PRESETS.find(
        (p) => p.rule.type === 'days' && p.rule.interval === rule.interval,
      );
      if (preset) return preset.label;
      return `Каждые ${rule.interval} дн.`;
    }
    case 'months':
      if (rule.interval === 1) return 'Каждый месяц';
      return `Каждые ${rule.interval} мес.`;
    case 'years':
      if (rule.interval === 1) return 'Каждый год';
      return `Каждые ${rule.interval} г.`;
    case 'weekdays':
      return formatWeekdays(rule.days);
  }
};
