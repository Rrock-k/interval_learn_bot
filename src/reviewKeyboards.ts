import { Markup } from 'telegraf';
import { config } from './config';
import { gradeOptions, reviewPresetIntervals } from './spacedRepetition';
import {
  SCHEDULE_PRESETS,
  ALL_WEEKDAYS,
  weekdayLabel,
} from './schedule';

export const REVIEW_ACTIONS = {
  grade: 'grade',
  adjust: 'adjust',
  preset: 'preset',
  back: 'review_back',
  archive: 'review_archive',
  changeSchedule: 'review_chsched',
  setSchedule: 'rs',
  weekdayToggle: 'rt',
  weekdayConfirm: 'rc',
} as const;

export const CARD_ACTIONS = {
  setSchedule: 'ss',
  weekdayToggle: 'wt',
  weekdayConfirm: 'wc',
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

export const buildAdjustKeyboard = (cardId: string, deepLinkUrl?: string) => {
  const maxIntervalDays = Math.max(1, config.maxIntervalDays);
  const presets = reviewPresetIntervals.filter((days) => days <= maxIntervalDays);
  const effectivePresets = presets.length ? presets : [maxIntervalDays];
  const buttons = effectivePresets.map((days) =>
    Markup.button.callback(
      formatPresetLabel(days),
      `${REVIEW_ACTIONS.preset}|${cardId}|${days}`,
    ),
  );

  type KeyboardButton =
    | ReturnType<typeof Markup.button.callback>
    | ReturnType<typeof Markup.button.url>;
  const rows: KeyboardButton[][] = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([
    Markup.button.callback('🔄 Изменить расписание', `${REVIEW_ACTIONS.changeSchedule}|${cardId}`),
  ]);
  if (deepLinkUrl) {
    rows.push([Markup.button.url('📱 Открыть в приложении', deepLinkUrl)]);
  }
  rows.push([
    Markup.button.callback('📦 Архивировать', `${REVIEW_ACTIONS.archive}|${cardId}`),
    Markup.button.callback('⬅️ Назад', `${REVIEW_ACTIONS.back}|${cardId}`),
  ]);

  return Markup.inlineKeyboard(rows);
};

// --- Schedule picker keyboards ---

/**
 * Build schedule picker for card creation (ctx = 'a') or review reschedule (ctx = 'r').
 */
export const buildSchedulePickerKeyboard = (
  cardId: string,
  ctx: 'a' | 'r',
) => {
  const ssAction = ctx === 'a' ? CARD_ACTIONS.setSchedule : REVIEW_ACTIONS.setSchedule;
  const wtAction = ctx === 'a' ? CARD_ACTIONS.weekdayToggle : REVIEW_ACTIONS.weekdayToggle;
  const backAction = ctx === 'a' ? `back_reminder|${cardId}` : `${REVIEW_ACTIONS.adjust}|${cardId}`;

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        'SM-2 интервалы',
        `${ssAction}|${cardId}|sm2`,
      ),
    ],
    [
      Markup.button.callback('Каждый день', `${ssAction}|${cardId}|d1`),
      Markup.button.callback('Через день', `${ssAction}|${cardId}|d2`),
    ],
    [
      Markup.button.callback('Каждую неделю', `${ssAction}|${cardId}|d7`),
      Markup.button.callback('Каждый месяц', `${ssAction}|${cardId}|m1`),
    ],
    [
      Markup.button.callback('Каждый год', `${ssAction}|${cardId}|y1`),
    ],
    [
      Markup.button.callback(
        '📅 Дни недели...',
        `${wtAction}|${cardId}||0`,
      ),
    ],
    [
      Markup.button.callback(
        '✏️ Написать своё',
        `custom_sched|${ctx}|${cardId}`,
      ),
    ],
    [Markup.button.callback('⬅️ Назад', backAction)],
  ]);
};

/**
 * Build weekday toggle keyboard.
 * selectedStr is a comma-separated list of selected days (1-7), e.g. "1,3,5"
 */
export const buildWeekdayPickerKeyboard = (
  cardId: string,
  ctx: 'a' | 'r',
  selectedStr: string,
) => {
  const selected = new Set(
    selectedStr
      .split(',')
      .map(Number)
      .filter((n) => n >= 1 && n <= 7),
  );

  const wtAction = ctx === 'a' ? CARD_ACTIONS.weekdayToggle : REVIEW_ACTIONS.weekdayToggle;
  const wcAction = ctx === 'a' ? CARD_ACTIONS.weekdayConfirm : REVIEW_ACTIONS.weekdayConfirm;
  const ssAction = ctx === 'a' ? CARD_ACTIONS.setSchedule : REVIEW_ACTIONS.setSchedule;

  const dayButtons = ALL_WEEKDAYS.map((day) => {
    const isSelected = selected.has(day);
    const label = isSelected ? `✅ ${weekdayLabel(day)}` : weekdayLabel(day);

    // Toggle: flip this day in the selection
    const newSelected = new Set(selected);
    if (isSelected) {
      newSelected.delete(day);
    } else {
      newSelected.add(day);
    }
    const newStr = [...newSelected].sort((a, b) => a - b).join(',');

    return Markup.button.callback(
      label,
      `${wtAction}|${cardId}|${newStr}|${day}`,
    );
  });

  // Layout: 4 + 3 buttons
  const rows = [dayButtons.slice(0, 4), dayButtons.slice(4, 7)];

  if (selected.size > 0) {
    rows.push([
      Markup.button.callback('✅ Готово', `${wcAction}|${cardId}|${selectedStr}`),
    ]);
  }

  // Back → re-open schedule picker
  rows.push([
    Markup.button.callback(
      '⬅️ Назад',
      `${ssAction}|${cardId}|pick`,
    ),
  ]);

  return Markup.inlineKeyboard(rows);
};
