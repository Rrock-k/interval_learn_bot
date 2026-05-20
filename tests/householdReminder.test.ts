import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import dayjs from 'dayjs';
import { parseHouseholdReminderText } from '../src/householdReminder';
import { computeNextFromSchedule } from '../src/schedule';

const now = dayjs('2026-05-20T08:00:00');

test('parseHouseholdReminderText creates one-time shopping reminder from natural text', () => {
  const plan = parseHouseholdReminderText('купить молоко завтра в 10', now);
  assert.ok(plan);
  assert.equal(plan.mode, 'one_time');
  assert.equal(plan.kind, 'shopping');
  assert.equal(plan.title, 'Купить молоко');
  assert.equal(dayjs(plan.remindAt).format('YYYY-MM-DD HH:mm'), '2026-05-21 10:00');
});

test('parseHouseholdReminderText creates daily medicine schedule with fixed time', () => {
  const plan = parseHouseholdReminderText('принять витамин каждый день в 9', now);
  assert.ok(plan);
  assert.equal(plan.mode, 'schedule');
  assert.equal(plan.kind, 'medicine');
  assert.equal(plan.title, 'Принять витамин');
  assert.deepEqual(plan.rule, { type: 'days', interval: 1, timeMinutes: 9 * 60 });
  assert.equal(plan.ruleText, 'Каждый день в 09:00');
  assert.equal(dayjs(plan.nextReviewAt).format('YYYY-MM-DD HH:mm'), '2026-05-20 09:00');
});

test('parseHouseholdReminderText creates annual birthday schedule', () => {
  const plan = parseHouseholdReminderText('день рождения мамы 25.05', now);
  assert.ok(plan);
  assert.equal(plan.mode, 'schedule');
  assert.equal(plan.kind, 'birthday');
  assert.equal(plan.title, 'День рождения мамы');
  assert.deepEqual(plan.rule, { type: 'annual_date', month: 5, day: 25, timeMinutes: 9 * 60 });
  assert.equal(dayjs(plan.nextReviewAt).format('YYYY-MM-DD HH:mm'), '2026-05-25 09:00');
});

test('computeNextFromSchedule advances annual dates to next year after the date passed', () => {
  const next = computeNextFromSchedule(
    { type: 'annual_date', month: 5, day: 25, timeMinutes: 9 * 60 },
    dayjs('2026-05-25T10:00:00'),
  );
  assert.equal(dayjs(next).format('YYYY-MM-DD HH:mm'), '2027-05-25 09:00');
});
