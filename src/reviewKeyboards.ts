import { Markup } from 'telegraf';
import { config } from './config';
import { gradeOptions, reviewPresetIntervals } from './spacedRepetition';

export const REVIEW_ACTIONS = {
  grade: 'grade',
  adjust: 'adjust',
  preset: 'preset',
  back: 'review_back',
} as const;

export const buildReviewKeyboard = (cardId: string) =>
  Markup.inlineKeyboard([
    gradeOptions.map((option) =>
      Markup.button.callback(
        `${option.emoji} ${option.label}`,
        `${REVIEW_ACTIONS.grade}|${cardId}|${option.key}`,
      ),
    ),
    [Markup.button.callback('⚙️ Настроить', `${REVIEW_ACTIONS.adjust}|${cardId}`)],
  ]);

const formatPresetLabel = (days: number) => `через ${days}д`;

export const buildAdjustKeyboard = (cardId: string) => {
  const maxIntervalDays = Math.max(1, config.maxIntervalDays);
  const presets = reviewPresetIntervals.filter((days) => days <= maxIntervalDays);
  const effectivePresets = presets.length ? presets : [maxIntervalDays];
  const buttons = effectivePresets.map((days) =>
    Markup.button.callback(
      formatPresetLabel(days),
      `${REVIEW_ACTIONS.preset}|${cardId}|${days}`,
    ),
  );

  const rows: typeof buttons[] = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([Markup.button.callback('⬅️ Назад', `${REVIEW_ACTIONS.back}|${cardId}`)]);

  return Markup.inlineKeyboard(rows);
};
