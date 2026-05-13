import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import dayjs from 'dayjs';
import {
  DeliverySettings,
  planReminderDelivery,
  planReminderRebalance,
} from '../src/reminderPlanner';

const settings: DeliverySettings = {
  timezone: 'Asia/Tbilisi',
  activeHoursStart: 10 * 60,
  activeHoursEnd: 22 * 60,
  minGapMinutes: 30,
};

test('planReminderDelivery keeps an empty target slot', () => {
  const dueAt = '2026-05-13T08:00:00.000Z'; // 12:00 Asia/Tbilisi
  assert.equal(planReminderDelivery({ dueAt, existingScheduledAt: [], settings }), dueAt);
});

test('planReminderDelivery normalizes outside active hours', () => {
  const dueAt = '2026-05-13T02:00:00.000Z'; // 06:00 Asia/Tbilisi
  const planned = planReminderDelivery({ dueAt, existingScheduledAt: [], settings });
  assert.equal(dayjs(planned).toISOString(), '2026-05-13T06:00:00.000Z'); // 10:00 Asia/Tbilisi
});

test('planReminderDelivery distributes away from crowded target time', () => {
  const dueAt = '2026-05-13T08:00:00.000Z'; // 12:00 Asia/Tbilisi
  const planned = planReminderDelivery({
    dueAt,
    existingScheduledAt: [
      '2026-05-13T08:00:00.000Z',
      '2026-05-13T08:30:00.000Z',
      '2026-05-13T09:00:00.000Z',
    ],
    settings,
  });
  assert.equal(dayjs(planned).toISOString(), '2026-05-13T09:30:00.000Z');
});

test('planReminderDelivery uses exact gaps around existing reminders', () => {
  const dueAt = '2026-05-13T08:00:00.000Z'; // 12:00 Asia/Tbilisi
  const planned = planReminderDelivery({
    dueAt,
    existingScheduledAt: ['2026-05-13T08:20:00.000Z'],
    settings,
  });
  assert.equal(dayjs(planned).toISOString(), '2026-05-13T08:50:00.000Z');
});

test('planReminderRebalance distributes a crowded batch without mutating fixed reminders', () => {
  const changes = planReminderRebalance({
    jobs: [
      {
        id: 'a',
        dueAt: '2026-05-13T08:00:00.000Z',
        scheduledAt: '2026-05-13T08:00:00.000Z',
      },
      {
        id: 'b',
        dueAt: '2026-05-13T08:00:00.000Z',
        scheduledAt: '2026-05-13T08:00:00.000Z',
      },
      {
        id: 'c',
        dueAt: '2026-05-13T08:00:00.000Z',
        scheduledAt: '2026-05-13T08:00:00.000Z',
      },
    ],
    fixedScheduledAt: ['2026-05-13T08:30:00.000Z'],
    settings,
    now: '2026-05-13T07:00:00.000Z',
  });

  assert.deepEqual(
    changes.map((change) => dayjs(change.afterScheduledAt).toISOString()),
    [
      '2026-05-13T08:00:00.000Z',
      '2026-05-13T09:00:00.000Z',
      '2026-05-13T09:30:00.000Z',
    ],
  );
});
