import dayjs from 'dayjs';
import { CardRecord } from './db';

export type GradeKey = 'again' | 'hard' | 'good' | 'easy';

export const gradeOptions: Array<{
  key: GradeKey;
  label: string;
  emoji: string;
}> = [
  { key: 'again', label: 'Снова', emoji: '🔁' },
  { key: 'hard', label: 'Сложно', emoji: '😬' },
  { key: 'good', label: 'Хорошо', emoji: '🙂' },
  { key: 'easy', label: 'Легко', emoji: '😎' },
];

const gradeToQuality: Record<GradeKey, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
};

export interface ReviewComputationResult {
  quality: number;
  easiness: number;
  interval: number;
  repetition: number;
  nextReviewAt: string;
}

const clampEasiness = (value: number): number => Math.max(1.3, Number(value.toFixed(2)));

export const computeReview = (card: CardRecord, grade: GradeKey): ReviewComputationResult => {
  const now = dayjs();
  const quality = gradeToQuality[grade];
  let easiness = card.easiness ?? 2.5;
  let repetition = card.repetition ?? 0;
  let interval = card.interval ?? 0;

  if (quality < 3) {
    repetition = 0;
    interval = 1;
  } else {
    repetition += 1;
    if (repetition === 1) {
      interval = 1;
    } else if (repetition === 2) {
      interval = 6;
    } else {
      interval = Math.max(1, Math.round(interval * easiness));
    }
    const adjustment = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    easiness = clampEasiness(easiness + adjustment);
  }

  const nextReviewAt = now.add(interval, 'day').toISOString();

  return {
    quality,
    easiness,
    interval,
    repetition,
    nextReviewAt,
  };
};

export const computeInitialReviewDate = (minutes: number): string => {
  const safeMinutes = Math.max(1, minutes);
  return dayjs().add(safeMinutes, 'minute').toISOString();
};
