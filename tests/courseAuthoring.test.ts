import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  LocalCourseDraftGenerator,
  normalizeCourseDraft,
  parseCourseDraftFromText,
} from '../src/courseAuthoring';

test('normalizeCourseDraft accepts a valid course draft', () => {
  const draft = normalizeCourseDraft({
    title: 'SQL Basics',
    description: 'Learn useful SQL.',
    steps: [
      { kind: 'material', title: 'SELECT', body: 'Read rows from a table.' },
      { kind: 'practice', title: 'Try it', body: 'Write one SELECT query.' },
    ],
  });

  assert.equal(draft?.title, 'SQL Basics');
  assert.equal(draft?.steps.length, 2);
});

test('parseCourseDraftFromText extracts JSON from an assistant message', () => {
  const draft = parseCourseDraftFromText(`
Here is the draft:
\`\`\`json
{"title":"Course","description":null,"steps":[{"kind":"question","title":"Check","body":"Answer it."}]}
\`\`\`
`);

  assert.equal(draft?.title, 'Course');
  assert.equal(draft?.steps[0]?.kind, 'question');
});

test('LocalCourseDraftGenerator returns a usable fallback draft', async () => {
  const generator = new LocalCourseDraftGenerator();
  const result = await generator.generateDraft({
    messages: [{ role: 'user', content: 'курс по SQL для новичков на 5 шагов' }],
  });

  assert.equal(result.provider, 'local_fallback');
  assert.ok(result.draft.title.includes('SQL'));
  assert.equal(result.draft.steps.length, 5);
});
