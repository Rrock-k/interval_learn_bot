import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildCourseStepCardText } from '../src/courses';

test('buildCourseStepCardText builds compact queue card text', () => {
  assert.equal(
    buildCourseStepCardText({
      courseTitle: 'Основы SQL',
      stepPosition: 3,
      totalSteps: 12,
      stepKind: 'practice',
      stepTitle: 'JOIN руками',
      body: 'Соберите запрос с INNER JOIN на двух таблицах.',
    }),
    'Курс: Основы SQL · Шаг 3 из 12 · Практика\n\nJOIN руками\n\nСоберите запрос с INNER JOIN на двух таблицах.',
  );
});

