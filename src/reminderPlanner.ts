import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface DeliverySettings {
  timezone: string;
  activeHoursStart: number;
  activeHoursEnd: number;
  minGapMinutes: number;
}

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  timezone: process.env.DEFAULT_REMINDER_TIMEZONE || 'Asia/Tbilisi',
  activeHoursStart: parseClockToMinutes(process.env.DEFAULT_ACTIVE_HOURS_START, 10 * 60),
  activeHoursEnd: parseClockToMinutes(process.env.DEFAULT_ACTIVE_HOURS_END, 22 * 60),
  minGapMinutes: parsePositiveInteger(process.env.DEFAULT_REMINDER_MIN_GAP_MINUTES, 30),
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseClockToMinutes(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return fallback;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

const minutesOfDay = (value: dayjs.Dayjs) => value.hour() * 60 + value.minute();

const setMinutesOfDay = (value: dayjs.Dayjs, minutes: number) =>
  value.hour(Math.floor(minutes / 60)).minute(minutes % 60).second(0).millisecond(0);

const normalizeToActiveWindow = (candidate: dayjs.Dayjs, settings: DeliverySettings) => {
  const start = Math.max(0, Math.min(settings.activeHoursStart, 23 * 60 + 59));
  const end = Math.max(start + 1, Math.min(settings.activeHoursEnd, 24 * 60));
  const currentMinutes = minutesOfDay(candidate);

  if (currentMinutes < start) {
    return setMinutesOfDay(candidate, start);
  }
  if (currentMinutes >= end) {
    return setMinutesOfDay(candidate.add(1, 'day'), start);
  }
  return candidate;
};

export const planReminderDelivery = ({
  dueAt,
  existingScheduledAt,
  settings,
}: {
  dueAt: string;
  existingScheduledAt: string[];
  settings: DeliverySettings;
}): string => {
  let candidate = normalizeToActiveWindow(dayjs(dueAt).tz(settings.timezone), settings);
  const minGap = Math.max(1, settings.minGapMinutes);
  const sortedExisting = existingScheduledAt
    .map((value) => dayjs(value).tz(settings.timezone))
    .filter((value) => value.isValid())
    .sort((a, b) => a.valueOf() - b.valueOf());

  for (const existing of sortedExisting) {
    const gapMinutes = Math.abs(candidate.diff(existing, 'minute'));
    if (gapMinutes < minGap) {
      candidate = normalizeToActiveWindow(existing.add(minGap, 'minute'), settings);
    }
  }

  return candidate.toISOString();
};
