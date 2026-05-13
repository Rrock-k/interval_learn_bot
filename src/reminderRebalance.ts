import { createHash } from 'node:crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  DeliverySettings,
  RebalancePlanChange,
  planReminderRebalance,
} from './reminderPlanner';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface ReminderRebalanceJob {
  id: string;
  cardId: string;
  contentPreview: string | null;
  dueAt: string;
  scheduledAt: string;
}

export interface ReminderRebalancePreviewChange extends RebalancePlanChange {
  jobId: string;
  cardId: string;
  contentPreview: string | null;
}

export interface ReminderHeatmap {
  days: string[];
  dayLabels: string[];
  slots: string[];
  before: number[][];
  after: number[][];
}

export interface ReminderRebalanceMetrics {
  total: number;
  moved: number;
  maxBucketBefore: number;
  maxBucketAfter: number;
  conflictCountBefore: number;
  conflictCountAfter: number;
  averageDeltaMinutes: number;
  maxDeltaMinutes: number;
}

export interface ReminderRebalancePreview {
  planToken: string;
  generatedAt: string;
  horizonDays: number;
  bucketMinutes: number;
  settings: DeliverySettings;
  range: {
    start: string;
    end: string;
  };
  metrics: ReminderRebalanceMetrics;
  heatmap: ReminderHeatmap;
  changes: ReminderRebalancePreviewChange[];
}

const clampHorizonDays = (value: number) => Math.min(30, Math.max(1, Math.floor(value)));
const clampBucketMinutes = (value: number) => Math.min(120, Math.max(15, Math.floor(value)));

const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const emptyMatrix = (rows: number, columns: number) =>
  Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));

const maxMatrixValue = (matrix: number[][]) =>
  matrix.reduce((max, row) => Math.max(max, ...row), 0);

const countConflicts = (scheduledAt: string[], minGapMinutes: number) => {
  const sorted = scheduledAt
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  let count = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    if ((sorted[index]! - sorted[index - 1]!) / 60_000 < minGapMinutes) {
      count += 1;
    }
  }
  return count;
};

const buildHeatmap = ({
  beforeScheduledAt,
  afterScheduledAt,
  settings,
  generatedAt,
  horizonDays,
  bucketMinutes,
}: {
  beforeScheduledAt: string[];
  afterScheduledAt: string[];
  settings: DeliverySettings;
  generatedAt: string;
  horizonDays: number;
  bucketMinutes: number;
}): ReminderHeatmap => {
  const dayStart = dayjs(generatedAt).tz(settings.timezone).startOf('day');
  const days = Array.from({ length: horizonDays }, (_value, index) =>
    dayStart.add(index, 'day').format('YYYY-MM-DD'),
  );
  const dayFormatter = new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    timeZone: settings.timezone,
  });
  const dayLabels = days.map((day) =>
    dayFormatter.format(dayjs.tz(day, settings.timezone).toDate()),
  );
  const slots: string[] = [];
  for (
    let minutes = settings.activeHoursStart;
    minutes < settings.activeHoursEnd;
    minutes += bucketMinutes
  ) {
    slots.push(formatTime(minutes));
  }

  const before = emptyMatrix(slots.length, days.length);
  const after = emptyMatrix(slots.length, days.length);
  const add = (matrix: number[][], scheduledAt: string) => {
    const value = dayjs(scheduledAt).tz(settings.timezone);
    if (!value.isValid()) return;
    const dayIndex = days.indexOf(value.format('YYYY-MM-DD'));
    if (dayIndex < 0) return;
    const minutes = value.hour() * 60 + value.minute();
    if (minutes < settings.activeHoursStart || minutes >= settings.activeHoursEnd) return;
    const slotIndex = Math.floor((minutes - settings.activeHoursStart) / bucketMinutes);
    if (!matrix[slotIndex]) return;
    matrix[slotIndex]![dayIndex] = (matrix[slotIndex]![dayIndex] ?? 0) + 1;
  };

  beforeScheduledAt.forEach((value) => add(before, value));
  afterScheduledAt.forEach((value) => add(after, value));
  return { days, dayLabels, slots, before, after };
};

export const buildReminderRebalancePreview = ({
  jobs,
  fixedScheduledAt,
  visibleFixedScheduledAt = fixedScheduledAt,
  settings,
  generatedAt = new Date().toISOString(),
  horizonDays,
  bucketMinutes,
}: {
  jobs: ReminderRebalanceJob[];
  fixedScheduledAt: string[];
  visibleFixedScheduledAt?: string[];
  settings: DeliverySettings;
  generatedAt?: string;
  horizonDays: number;
  bucketMinutes: number;
}): ReminderRebalancePreview => {
  const normalizedHorizonDays = clampHorizonDays(horizonDays);
  const normalizedBucketMinutes = clampBucketMinutes(bucketMinutes);
  const planned = planReminderRebalance({
    jobs: jobs.map((job) => ({
      id: job.id,
      dueAt: job.dueAt,
      scheduledAt: job.scheduledAt,
    })),
    fixedScheduledAt,
    settings,
    now: generatedAt,
  });
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const changes = planned.map((change) => {
    const job = jobById.get(change.id);
    return {
      ...change,
      jobId: change.id,
      cardId: job?.cardId ?? '',
      contentPreview: job?.contentPreview ?? null,
    };
  });
  const beforeScheduledAt = [
    ...visibleFixedScheduledAt,
    ...changes.map((change) => change.beforeScheduledAt),
  ];
  const afterScheduledAt = [
    ...visibleFixedScheduledAt,
    ...changes.map((change) => change.afterScheduledAt),
  ];
  const heatmap = buildHeatmap({
    beforeScheduledAt,
    afterScheduledAt,
    settings,
    generatedAt,
    horizonDays: normalizedHorizonDays,
    bucketMinutes: normalizedBucketMinutes,
  });
  const movedChanges = changes.filter((change) => change.deltaMinutes !== 0);
  const absoluteDeltas = movedChanges.map((change) => Math.abs(change.deltaMinutes));
  const metrics = {
    total: beforeScheduledAt.length,
    moved: movedChanges.length,
    maxBucketBefore: maxMatrixValue(heatmap.before),
    maxBucketAfter: maxMatrixValue(heatmap.after),
    conflictCountBefore: countConflicts(beforeScheduledAt, settings.minGapMinutes),
    conflictCountAfter: countConflicts(afterScheduledAt, settings.minGapMinutes),
    averageDeltaMinutes: absoluteDeltas.length
      ? Math.round(absoluteDeltas.reduce((total, value) => total + value, 0) / absoluteDeltas.length)
      : 0,
    maxDeltaMinutes: absoluteDeltas.length ? Math.max(...absoluteDeltas) : 0,
  };
  const tokenPayload = JSON.stringify({
    generatedAt,
    horizonDays: normalizedHorizonDays,
    settings,
    changes: changes.map((change) => [
      change.jobId,
      change.beforeScheduledAt,
      change.afterScheduledAt,
    ]),
  });
  return {
    planToken: createHash('sha256').update(tokenPayload).digest('hex'),
    generatedAt,
    horizonDays: normalizedHorizonDays,
    bucketMinutes: normalizedBucketMinutes,
    settings,
    range: {
      start: dayjs(generatedAt).tz(settings.timezone).startOf('day').toISOString(),
      end: dayjs(generatedAt)
        .tz(settings.timezone)
        .startOf('day')
        .add(normalizedHorizonDays, 'day')
        .toISOString(),
    },
    metrics,
    heatmap,
    changes,
  };
};
