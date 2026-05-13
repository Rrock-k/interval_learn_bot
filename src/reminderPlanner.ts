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

export interface RebalanceJobInput {
  id: string;
  dueAt: string;
  scheduledAt: string;
}

export interface RebalancePlanChange {
  id: string;
  dueAt: string;
  beforeScheduledAt: string;
  afterScheduledAt: string;
  deltaMinutes: number;
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

const activeWindowBounds = (settings: DeliverySettings) => ({
  start: Math.max(0, Math.min(settings.activeHoursStart, 23 * 60 + 59)),
  end: Math.max(
    Math.max(0, Math.min(settings.activeHoursStart, 23 * 60 + 59)) + 1,
    Math.min(settings.activeHoursEnd, 24 * 60),
  ),
});

const isInsideActiveWindow = (candidate: dayjs.Dayjs, settings: DeliverySettings) => {
  const { start, end } = activeWindowBounds(settings);
  const currentMinutes = minutesOfDay(candidate);
  return currentMinutes >= start && currentMinutes < end;
};

const candidateKey = (candidate: dayjs.Dayjs) => String(candidate.valueOf());

const candidateConflictMinutes = (
  candidate: dayjs.Dayjs,
  existing: dayjs.Dayjs[],
  minGap: number,
) =>
  existing.reduce((total, value) => {
    const distance = Math.abs(candidate.diff(value, 'minute', true));
    return total + Math.max(0, minGap - distance);
  }, 0);

const candidateDensityPenalty = (
  candidate: dayjs.Dayjs,
  existing: dayjs.Dayjs[],
  minGap: number,
) => {
  const densityWindow = Math.max(minGap * 4, 120);
  return existing.reduce((total, value) => {
    const distance = Math.abs(candidate.diff(value, 'minute', true));
    if (distance >= densityWindow) return total;
    return total + (densityWindow - distance) / densityWindow;
  }, 0);
};

const sparseCandidates = ({
  target,
  existing,
  minGap,
  settings,
}: {
  target: dayjs.Dayjs;
  existing: dayjs.Dayjs[];
  minGap: number;
  settings: DeliverySettings;
}) => {
  const { start, end } = activeWindowBounds(settings);
  const horizonEnd = target.add(7, 'day');
  const stepMinutes = Math.max(5, Math.min(minGap, 30));
  const candidates = new Map<string, dayjs.Dayjs>();
  const addCandidate = (value: dayjs.Dayjs) => {
    if (!value.isValid()) return;
    const normalized = normalizeToActiveWindow(value, settings);
    if (normalized.isBefore(target)) return;
    if (normalized.isAfter(horizonEnd)) return;
    if (!isInsideActiveWindow(normalized, settings)) return;
    candidates.set(candidateKey(normalized), normalized);
  };

  addCandidate(target);
  for (const existingValue of existing) {
    addCandidate(existingValue.add(minGap, 'minute'));
    addCandidate(existingValue.subtract(minGap, 'minute'));
  }

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const day = target.startOf('day').add(dayOffset, 'day');
    let cursor = setMinutesOfDay(day, start);
    const windowEnd = setMinutesOfDay(day, end);
    if (cursor.isBefore(target)) {
      cursor = target;
    }
    cursor = normalizeToActiveWindow(cursor, settings);
    while (cursor.isBefore(windowEnd) && !cursor.isAfter(horizonEnd)) {
      addCandidate(cursor);
      cursor = cursor.add(stepMinutes, 'minute');
    }
  }

  return Array.from(candidates.values()).sort((a, b) => a.valueOf() - b.valueOf());
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

  const candidates = sparseCandidates({
    target: candidate,
    existing: sortedExisting,
    minGap,
    settings,
  });
  const scoredCandidates = candidates
    .map((value) => {
      const conflict = candidateConflictMinutes(value, sortedExisting, minGap);
      const density = candidateDensityPenalty(value, sortedExisting, minGap);
      const distance = Math.abs(value.diff(candidate, 'minute', true));
      return {
        value,
        score: conflict * 10_000 + density * minGap + distance,
      };
    })
    .sort((a, b) => a.score - b.score || a.value.valueOf() - b.value.valueOf());
  const bestCandidate = scoredCandidates[0]?.value;
  if (bestCandidate) {
    return bestCandidate.toISOString();
  }

  for (const existing of sortedExisting) {
    const gapMinutes = Math.abs(candidate.diff(existing, 'minute'));
    if (gapMinutes < minGap) {
      candidate = normalizeToActiveWindow(existing.add(minGap, 'minute'), settings);
    }
  }

  return candidate.toISOString();
};

export const planReminderRebalance = ({
  jobs,
  fixedScheduledAt,
  settings,
  now = new Date().toISOString(),
}: {
  jobs: RebalanceJobInput[];
  fixedScheduledAt: string[];
  settings: DeliverySettings;
  now?: string;
}): RebalancePlanChange[] => {
  const nowMs = Date.parse(now);
  const existingScheduledAt = [...fixedScheduledAt];
  const sortedJobs = [...jobs].sort((a, b) => {
    const dueDiff = Date.parse(a.dueAt) - Date.parse(b.dueAt);
    if (dueDiff !== 0) return dueDiff;
    const scheduledDiff = Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);
    if (scheduledDiff !== 0) return scheduledDiff;
    return a.id.localeCompare(b.id);
  });

  return sortedJobs.map((job) => {
    const dueMs = Date.parse(job.dueAt);
    const scheduledMs = Date.parse(job.scheduledAt);
    const fallbackMs = Number.isFinite(scheduledMs) ? scheduledMs : nowMs;
    const targetMs = Number.isFinite(dueMs)
      ? Number.isFinite(nowMs)
        ? Math.max(dueMs, nowMs)
        : dueMs
      : fallbackMs;
    const target = new Date(targetMs).toISOString();
    const planned = planReminderDelivery({
      dueAt: target,
      existingScheduledAt,
      settings,
    });
    existingScheduledAt.push(planned);
    return {
      id: job.id,
      dueAt: job.dueAt,
      beforeScheduledAt: job.scheduledAt,
      afterScheduledAt: planned,
      deltaMinutes: Math.round((Date.parse(planned) - Date.parse(job.scheduledAt)) / 60_000),
    };
  });
};
