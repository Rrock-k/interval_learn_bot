import { Markup } from 'telegraf';
import dayjs from 'dayjs';
import { config } from './config';
import { reviewPresetIntervals } from './spacedRepetition';
import {
  SCHEDULE_PRESETS,
  ALL_WEEKDAYS,
  weekdayLabel,
} from './schedule';

export const REVIEW_ACTIONS = {
  grade: 'grade',
  adjust: 'adjust',
  snooze: 'snooze',
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
  setOneTime: 'ot',
  openOneTimeCalendar: 'oc',
  pickOneTimeDate: 'od',
  setOneTimeDateTime: 'ott',
  customOneTime: 'ou',
  noop: 'noop',
  weekdayToggle: 'wt',
  weekdayConfirm: 'wc',
} as const;

export const buildReminderJobKeyboard = (
  cardId: string,
  jobId: string,
  kind: 'review' | 'one_time' | 'manual_now',
) => {
  if (kind === 'one_time') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('⚙️ Настроить', `${REVIEW_ACTIONS.adjust}|${jobId}`),
        Markup.button.callback(
          '✅ Окей',
          `${REVIEW_ACTIONS.grade}|${jobId}|ok`,
        ),
      ],
    ]);
  }

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⚙️ Настроить', `${REVIEW_ACTIONS.adjust}|${jobId}`),
      Markup.button.callback(
        '✅ Окей',
        `${REVIEW_ACTIONS.grade}|${jobId}|ok`,
      ),
    ],
  ]);
};

export const buildReviewKeyboard = (cardId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('⚙️ Настроить', `${REVIEW_ACTIONS.adjust}|${cardId}`),
      Markup.button.callback('✅ Окей', `${REVIEW_ACTIONS.grade}|${cardId}|ok`),
    ],
  ]);

export const buildOneTimePickerKeyboard = (cardId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('Через час', `${CARD_ACTIONS.setOneTime}|${cardId}|hour`),
    ],
    [
      Markup.button.callback('Вечером', `${CARD_ACTIONS.setOneTime}|${cardId}|evening`),
      Markup.button.callback('Завтра утром', `${CARD_ACTIONS.setOneTime}|${cardId}|morning`),
    ],
    [
      Markup.button.callback(
        '📅 Выбрать дату',
        `${CARD_ACTIONS.openOneTimeCalendar}|${cardId}|${dayjs().format('YYYY-MM')}`,
      ),
    ],
    [
      Markup.button.callback('✏️ Написать своё', `${CARD_ACTIONS.customOneTime}|${cardId}`),
    ],
    [Markup.button.callback('⬅️ Назад', `back_reminder|${cardId}`)],
  ]);

export const buildOneTimeCalendarKeyboard = (cardId: string, monthValue: string) => {
  const month = dayjs(`${monthValue}-01`);
  const safeMonth = month.isValid() ? month : dayjs().startOf('month');
  const monthStart = safeMonth.startOf('month');
  const daysInMonth = monthStart.daysInMonth();
  const startDow = (monthStart.day() + 6) % 7;
  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [
      Markup.button.callback(
        '‹',
        `${CARD_ACTIONS.openOneTimeCalendar}|${cardId}|${monthStart.subtract(1, 'month').format('YYYY-MM')}`,
      ),
      Markup.button.callback(
        monthStart.format('MM.YYYY'),
        `${CARD_ACTIONS.noop}|${cardId}`,
      ),
      Markup.button.callback(
        '›',
        `${CARD_ACTIONS.openOneTimeCalendar}|${cardId}|${monthStart.add(1, 'month').format('YYYY-MM')}`,
      ),
    ],
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label) =>
      Markup.button.callback(label, `${CARD_ACTIONS.noop}|${cardId}`),
    ),
  ];
  let row: ReturnType<typeof Markup.button.callback>[] = [];
  for (let i = 0; i < startDow; i += 1) {
    row.push(Markup.button.callback(' ', `${CARD_ACTIONS.noop}|${cardId}`));
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = monthStart.date(day).format('YYYY-MM-DD');
    row.push(
      Markup.button.callback(
        String(day),
        `${CARD_ACTIONS.pickOneTimeDate}|${cardId}|${date}`,
      ),
    );
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) {
    while (row.length < 7) {
      row.push(Markup.button.callback(' ', `${CARD_ACTIONS.noop}|${cardId}`));
    }
    rows.push(row);
  }
  rows.push([Markup.button.callback('⬅️ Назад', `choose_one_time|${cardId}`)]);
  return Markup.inlineKeyboard(rows);
};

export const buildOneTimeTimeKeyboard = (cardId: string, date: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('10:00', `${CARD_ACTIONS.setOneTimeDateTime}|${cardId}|${date}|1000`),
      Markup.button.callback('14:00', `${CARD_ACTIONS.setOneTimeDateTime}|${cardId}|${date}|1400`),
      Markup.button.callback('20:00', `${CARD_ACTIONS.setOneTimeDateTime}|${cardId}|${date}|2000`),
    ],
    [Markup.button.callback('✏️ Написать своё', `${CARD_ACTIONS.customOneTime}|${cardId}`)],
    [
      Markup.button.callback(
        '⬅️ Назад к календарю',
        `${CARD_ACTIONS.openOneTimeCalendar}|${cardId}|${date.slice(0, 7)}`,
      ),
    ],
  ]);

const formatPresetLabel = (days: number) => `через ${days}д`;

export const buildAdjustKeyboard = (
  subjectId: string,
  deepLinkUrl?: string,
  options: { cardId?: string; compact?: boolean } = {},
) => {
  const cardId = options.cardId ?? subjectId;
  const maxIntervalDays = Math.max(1, config.maxIntervalDays);
  const presets = reviewPresetIntervals.filter((days) => days <= maxIntervalDays);
  const effectivePresets = presets.length ? presets : [maxIntervalDays];
  const buttons = effectivePresets.map((days) =>
    Markup.button.callback(
      formatPresetLabel(days),
      `${REVIEW_ACTIONS.preset}|${subjectId}|${days}`,
    ),
  );

  type KeyboardButton =
    | ReturnType<typeof Markup.button.callback>
    | ReturnType<typeof Markup.button.url>;
  const rows: KeyboardButton[][] = [];
  if (options.compact) {
    rows.push([
      Markup.button.callback('🔁 Снова', `${REVIEW_ACTIONS.grade}|${subjectId}|again`),
    ]);
  }
  if (!options.compact) {
    rows.push([
      Markup.button.callback('🔁 Снова', `${REVIEW_ACTIONS.grade}|${subjectId}|again`),
    ]);
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(buttons.slice(i, i + 3));
    }
    rows.push([
      Markup.button.callback('🔄 Изменить расписание', `${REVIEW_ACTIONS.changeSchedule}|${subjectId}`),
    ]);
  }
  if (deepLinkUrl) {
    rows.push([Markup.button.url('📱 Открыть в приложении', deepLinkUrl)]);
  }
  rows.push([
    Markup.button.callback('📦 Архивировать', `${REVIEW_ACTIONS.archive}|${cardId}`),
    Markup.button.callback('⬅️ Назад', `${REVIEW_ACTIONS.back}|${subjectId}`),
  ]);

  return Markup.inlineKeyboard(rows);
};

export const buildReminderManagementKeyboard = (cardId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '⚙️ Настроить',
        `${REVIEW_ACTIONS.adjust}|${cardId}`,
      ),
    ],
  ]);

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
