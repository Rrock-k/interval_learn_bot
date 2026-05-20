import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { slugifyCourseTitle } from '../src/courseMarketplace';

test('slugifyCourseTitle builds URL-friendly course slugs', () => {
  assert.equal(slugifyCourseTitle(' SQL Basics: JOIN & GROUP BY! '), 'sql-basics-join-group-by');
});

test('slugifyCourseTitle falls back for non-latin titles', () => {
  assert.equal(slugifyCourseTitle('Основы курса'), 'course');
});
