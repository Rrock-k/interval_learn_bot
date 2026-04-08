import dayjs from 'dayjs';
import { config } from './config';
import { CardRecord, ReminderMode } from './db';
import { computeNextFromSchedule, parseScheduleRule } from './schedule';

export type GradeKey = 'again' | 'ok';

export const gradeOptions: Array<{
  key: GradeKey;
  label: string;
  emoji: string;
}> = [
  { key: 'again', label: 'Снова', emoji: '🔁' },
  { key: 'ok', label: 'Окей', emoji: '✅' },
];

export interface ReviewComputationResult {
  repetition: number;
  nextReviewAt: string;
}

export const reviewIntervalLadder = [1, 3, 7, 14, 30];
export const reviewPresetIntervals = [3, 7, 14, 30];

const clampInterval = (interval: number): number => {
  const maxIntervalDays = Math.max(1, config.maxIntervalDays);
  return Math.min(Math.max(1, interval), maxIntervalDays);
};

const intervalFromRepetition = (repetition: number): number => {
  const index = Math.min(
    Math.max(repetition - 1, 0),
    reviewIntervalLadder.length - 1,
  );
  return reviewIntervalLadder[index] ?? 1;
};

const repetitionFromInterval = (interval: number): number => {
  const index = reviewIntervalLadder.findIndex((value) => value >= interval);
  if (index === -1) {
    return reviewIntervalLadder.length;
  }
  return index + 1;
};

export const computeReview = (card: CardRecord, grade: GradeKey): ReviewComputationResult => {
  const now = dayjs();

  // Schedule mode: use the stored rule to compute next date
  if (card.reminderMode === 'schedule') {
    const rule = parseScheduleRule(card.scheduleRule);
    if (rule) {
      return {
        repetition: (card.repetition ?? 0) + 1,
        nextReviewAt: computeNextFromSchedule(rule),
      };
    }
    // Fallback: if no rule, treat as daily
    return {
      repetition: (card.repetition ?? 0) + 1,
      nextReviewAt: now.add(1, 'day').toISOString(),
    };
  }

  // SM-2 mode: grade-based logic
  let repetition = card.repetition ?? 0;
  let interval = 0;

  if (grade === 'again') {
    repetition = 0;
    interval = 1;
  } else {
    repetition += 1;
    interval = intervalFromRepetition(repetition);
  }

  interval = clampInterval(interval);

  const nextReviewAt = now.add(interval, 'day').toISOString();

  return {
    repetition,
    nextReviewAt,
  };
};

export const computeReviewWithInterval = (
  intervalDays: number,
): ReviewComputationResult => {
  const now = dayjs();
  const interval = clampInterval(intervalDays);
  const repetition = repetitionFromInterval(interval);
  const nextReviewAt = now.add(interval, 'day').toISOString();

  return {
    repetition,
    nextReviewAt,
  };
};

export const computeInitialReviewDate = (minutes: number): string => {
  const safeMinutes = Math.max(1, minutes);
  return dayjs().add(safeMinutes, 'minute').toISOString();
};

export const computeInitialReviewDateForMode = (
  reminderMode: ReminderMode,
  scheduleRule: string | null,
  minutes: number,
): string => {
  if (reminderMode === 'schedule') {
    const rule = parseScheduleRule(scheduleRule);
    if (rule) {
      return computeNextFromSchedule(rule);
    }
  }
  return computeInitialReviewDate(minutes);
};
