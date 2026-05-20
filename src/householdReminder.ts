import dayjs from 'dayjs';
import {
  ScheduleRule,
  computeNextFromSchedule,
  parseNaturalSchedule,
  scheduleRuleLabel,
  serializeScheduleRule,
} from './schedule';
import { parseOneTimeReminderText } from './oneTimeReminder';

export type HouseholdReminderKind = 'shopping' | 'medicine' | 'birthday' | 'general';

export type HouseholdReminderPlan =
  | {
      mode: 'one_time';
      kind: HouseholdReminderKind;
      title: string;
      remindAt: string;
    }
  | {
      mode: 'schedule';
      kind: HouseholdReminderKind;
      title: string;
      rule: ScheduleRule;
      ruleText: string;
      scheduleRule: string;
      nextReviewAt: string;
    };

type FragmentMatch = {
  text: string;
  remindAt: string;
};

export const parseHouseholdReminderText = (
  input: string,
  now: dayjs.Dayjs = dayjs(),
): HouseholdReminderPlan | null => {
  const text = normalizeInput(input);
  if (!text) return null;

  const kind = detectKind(text);
  const timeMinutes = extractTimeMinutes(text);
  const birthdayDate = extractDottedDate(text);

  if (kind === 'birthday' && birthdayDate) {
    const rule: ScheduleRule = {
      type: 'annual_date',
      month: birthdayDate.month,
      day: birthdayDate.day,
      timeMinutes: timeMinutes ?? 9 * 60,
    };
    return {
      mode: 'schedule',
      kind,
      title: cleanupTitle(text, {
        remove: [birthdayDate.raw],
        fallback: fallbackTitle(kind),
      }),
      rule,
      ruleText: scheduleRuleLabel(rule),
      scheduleRule: serializeScheduleRule(rule),
      nextReviewAt: computeNextFromSchedule(rule, now),
    };
  }

  const scheduleRule = parseNaturalSchedule(text);
  if (scheduleRule) {
    const rule = withTime(scheduleRule, timeMinutes);
    return {
      mode: 'schedule',
      kind,
      title: cleanupTitle(text, {
        remove: [extractSchedulePhrase(text), extractTimePhrase(text)].filter(Boolean) as string[],
        fallback: fallbackTitle(kind),
      }),
      rule,
      ruleText: scheduleRuleLabel(rule),
      scheduleRule: serializeScheduleRule(rule),
      nextReviewAt: computeNextFromSchedule(rule, now),
    };
  }

  const oneTime = extractOneTimeFragment(text, now);
  if (!oneTime) return null;

  return {
    mode: 'one_time',
    kind,
    title: cleanupTitle(text, {
      remove: [oneTime.text],
      fallback: fallbackTitle(kind),
    }),
    remindAt: oneTime.remindAt,
  };
};

const normalizeInput = (input: string) => input.trim().replace(/\s+/g, ' ');

const detectKind = (text: string): HouseholdReminderKind => {
  const lower = text.toLowerCase();
  if (/(день рождения|\bдр\b|birthday)/i.test(lower)) return 'birthday';
  if (/(лекар|таблет|витамин|мг\b|(?:^|\s)(?:принять|выпить|пить)(?:\s|$))/i.test(lower)) return 'medicine';
  if (/(купить|покупк|магазин|продукт|заказать)/i.test(lower)) return 'shopping';
  return 'general';
};

const fallbackTitle = (kind: HouseholdReminderKind) => {
  if (kind === 'shopping') return 'Покупки';
  if (kind === 'medicine') return 'Принять лекарство';
  if (kind === 'birthday') return 'День рождения';
  return 'Напоминание';
};

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const cleanupTitle = (
  input: string,
  options: { remove: string[]; fallback: string },
) => {
  let title = input;
  for (const fragment of options.remove) {
    title = title.replace(fragment, ' ');
  }
  title = title
    .replace(/\b(каждый|каждую|каждые|ежедневно|еженедельно|ежемесячно|ежегодно)\b/gi, ' ')
    .replace(/\b(по будням|по выходным|раз в|через день|через неделю|через месяц|через год)\b/gi, ' ')
    .replace(/\b(напомни|напомнить)\b/gi, ' ')
    .replace(/\b(мне|надо|нужно|пожалуйста)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return capitalize(title || options.fallback);
};

const extractTimeMinutes = (text: string): number | null => {
  const match = text.match(/(?:^|\s)(?:в|к)\s*(\d{1,2})(?::(\d{2}))?(?:\s|$)/i);
  if (match) {
    const hours = Number(match[1]);
    const minutes = match[2] ? Number(match[2]) : 0;
    if (
      Number.isInteger(hours) &&
      Number.isInteger(minutes) &&
      hours >= 0 &&
      hours <= 23 &&
      minutes >= 0 &&
      minutes <= 59
    ) {
      return hours * 60 + minutes;
    }
  }
  if (/\bутром\b/i.test(text)) return 10 * 60;
  if (/\bвечером\b/i.test(text)) return 20 * 60;
  return null;
};

const extractTimePhrase = (text: string): string | null => {
  const match = text.match(/(?:^|\s)(?:в|к)\s*\d{1,2}(?::\d{2})?(?:\s|$)/i);
  if (match) return match[0];
  const word = text.match(/\b(утром|вечером)\b/i);
  return word?.[0] ?? null;
};

const extractDottedDate = (text: string): { raw: string; day: number; month: number } | null => {
  const match = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./]\d{2,4})?\b/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  return { raw: match[0], day, month };
};

const withTime = (rule: ScheduleRule, timeMinutes: number | null): ScheduleRule => {
  if (!Number.isInteger(timeMinutes)) return rule;
  return { ...rule, timeMinutes: timeMinutes ?? undefined } as ScheduleRule;
};

const extractSchedulePhrase = (text: string): string => {
  const match = text.match(
    /(каждый день|каждую неделю|каждый месяц|каждый год|ежедневно|еженедельно|ежемесячно|ежегодно|через день|через неделю|через месяц|через год|каждые?\s+\d+\s+[а-яё]+|раз\s+в\s+\d*\s*[а-яё]+|по\s+будням|по\s+выходным|по\s+[а-яё,\s]+|пн|вт|ср|чт|пт|сб|вс)/i,
  );
  return match?.[0] ?? '';
};

const ONE_TIME_PATTERNS = [
  /(?:^|\s)сегодня вечером(?=\s|$)/i,
  /(?:^|\s)завтра вечером(?=\s|$)/i,
  /(?:^|\s)завтра утром(?=\s|$)/i,
  /(?:^|\s)завтра\s+(?:в\s+)?\d{1,2}(?::\d{2})?(?=\s|$)/i,
  /(?:^|\s)завтра(?=\s|$)/i,
  /(?:^|\s)послезавтра\s+(?:в\s+)?\d{1,2}(?::\d{2})?(?=\s|$)/i,
  /(?:^|\s)послезавтра(?=\s|$)/i,
  /(?:^|\s)через\s+(?:(?:\d+)\s*)?[а-яёa-z.]+(?=\s|$)/i,
  /\b\d{4}-\d{1,2}-\d{1,2}(?:\s+(?:в\s+)?\d{1,2}(?::\d{2})?)?\b/i,
  /\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?(?:\s+(?:в\s+)?\d{1,2}(?::\d{2})?)?\b/i,
  /(?:^|\s)(?:сегодня\s+)?(?:в\s+)?\d{1,2}(?::\d{2})?(?:\s|$)/i,
];

const extractOneTimeFragment = (text: string, now: dayjs.Dayjs): FragmentMatch | null => {
  for (const pattern of ONE_TIME_PATTERNS) {
    const match = text.match(pattern);
    const raw = match?.[0]?.trim();
    if (!raw) continue;
    const remindAt = parseOneTimeFragment(raw, now);
    if (remindAt) {
      return { text: raw, remindAt };
    }
  }
  return null;
};

const parseOneTimeFragment = (fragment: string, now: dayjs.Dayjs): string | null => {
  const normalized = fragment.trim().toLowerCase();
  const tomorrowEvening = normalized.match(/^завтра вечером$/);
  if (tomorrowEvening) {
    return now.add(1, 'day').hour(20).minute(0).second(0).millisecond(0).toISOString();
  }

  const afterTomorrowTime = normalized.match(/^послезавтра\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?$/);
  if (afterTomorrowTime) {
    const hours = Number(afterTomorrowTime[1]);
    const minutes = afterTomorrowTime[2] ? Number(afterTomorrowTime[2]) : 0;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return now.add(2, 'day').hour(hours).minute(minutes).second(0).millisecond(0).toISOString();
    }
  }

  return parseOneTimeReminderText(normalized, now);
};
