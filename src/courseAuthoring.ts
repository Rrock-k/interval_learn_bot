import { fetch } from 'undici';
import { CourseStepKind } from './courses';

export type CourseAuthoringRole = 'user' | 'assistant';

export type CourseAuthoringMessage = {
  role: CourseAuthoringRole;
  content: string;
};

export type CourseDraftStep = {
  kind: CourseStepKind;
  title: string;
  body: string;
};

export type CourseDraft = {
  title: string;
  description: string | null;
  steps: CourseDraftStep[];
};

export type CourseAuthoringRequest = {
  messages: CourseAuthoringMessage[];
};

export type CourseAuthoringResult = {
  assistantMessage: string;
  draft: CourseDraft;
  provider: string;
};

export interface CourseDraftGenerator {
  provider: string;
  generateDraft(input: CourseAuthoringRequest): Promise<CourseAuthoringResult>;
}

const allowedStepKinds: CourseStepKind[] = ['material', 'practice', 'question'];

export const normalizeCourseDraft = (value: unknown): CourseDraft | null => {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description.trim()
    : null;
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const steps = rawSteps
    .map((entry) => {
      const step = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const kind = allowedStepKinds.includes(step.kind as CourseStepKind)
        ? (step.kind as CourseStepKind)
        : 'material';
      const stepTitle = typeof step.title === 'string' ? step.title.trim() : '';
      const body = typeof step.body === 'string' ? step.body.trim() : '';
      return { kind, title: stepTitle, body };
    })
    .filter((step) => step.title && step.body)
    .slice(0, 100);

  if (!title || steps.length === 0) {
    return null;
  }
  return { title, description, steps };
};

export const parseCourseDraftFromText = (text: string): CourseDraft | null => {
  const candidates = [
    ...extractFencedJsonBlocks(text),
    extractFirstJsonObject(text),
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const draft = normalizeCourseDraft(parsed);
      if (draft) return draft;
    } catch (_error) {
      continue;
    }
  }
  return null;
};

export class LocalCourseDraftGenerator implements CourseDraftGenerator {
  provider = 'local_fallback';

  async generateDraft(input: CourseAuthoringRequest): Promise<CourseAuthoringResult> {
    const draft = buildLocalCourseDraft(input.messages);
    return {
      provider: this.provider,
      draft,
      assistantMessage: formatDraftMessage(draft, 'Я собрал черновик курса. Его можно отредактировать справа или уточнить в чате.'),
    };
  }
}

export class OpenAICompatibleCourseDraftGenerator implements CourseDraftGenerator {
  provider = 'openai_compatible';

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
    },
  ) {}

  async generateDraft(input: CourseAuthoringRequest): Promise<CourseAuthoringResult> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: courseAuthoringSystemPrompt },
          ...input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Course authoring LLM failed: ${response.status}`);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const draft = parseCourseDraftFromText(content);
    if (!draft) {
      throw new Error('Course authoring LLM returned invalid course draft');
    }

    return {
      provider: this.provider,
      draft,
      assistantMessage: formatDraftMessage(draft, 'Готов черновик курса. Проверь структуру справа, затем создай курс.'),
    };
  }
}

export const createCourseDraftGenerator = (options: {
  apiKey: string | null;
  baseUrl: string;
  model: string | null;
}): CourseDraftGenerator => {
  if (options.apiKey && options.model) {
    return new OpenAICompatibleCourseDraftGenerator({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    });
  }
  return new LocalCourseDraftGenerator();
};

const courseAuthoringSystemPrompt = `
You are a course authoring assistant for a spaced-repetition Telegram learning app.
Return only a JSON object with this shape:
{
  "title": "short course title",
  "description": "one sentence course outcome",
  "steps": [
    { "kind": "material", "title": "step title", "body": "short lesson content" },
    { "kind": "practice", "title": "step title", "body": "small action for the learner" },
    { "kind": "question", "title": "step title", "body": "self-check question and expected answer" }
  ]
}
Rules:
- Make courses concise and useful in a reminder queue.
- Use 5 to 12 steps unless the user asks otherwise.
- Each body should be self-contained and readable as one Telegram card.
- Use kind values only: material, practice, question.
- Preserve the user's language.
`.trim();

const buildLocalCourseDraft = (messages: CourseAuthoringMessage[]): CourseDraft => {
  const prompt = lastUserMessage(messages) || 'короткий полезный курс';
  const topic = extractTopic(prompt);
  const stepCount = extractStepCount(prompt) ?? 6;
  const baseSteps: CourseDraftStep[] = [
    {
      kind: 'material',
      title: `Что важно понять про ${topic}`,
      body: `Сформулируйте главный результат: что ученик сможет делать после курса про ${topic}. Держите фокус на одном практическом навыке.`,
    },
    {
      kind: 'material',
      title: 'Карта темы',
      body: `Разбейте ${topic} на 3-5 понятных блоков: базовые идеи, типичные ошибки, рабочие примеры и самостоятельная практика.`,
    },
    {
      kind: 'practice',
      title: 'Мини-практика',
      body: `Сделайте маленькое упражнение по теме "${topic}": примените одну идею на реальном примере и запишите результат в 2-3 строках.`,
    },
    {
      kind: 'question',
      title: 'Самопроверка',
      body: `Ответьте без подсказок: какая одна ошибка чаще всего мешает разобраться в теме "${topic}" и как её заметить заранее?`,
    },
    {
      kind: 'practice',
      title: 'Применение',
      body: `Выберите свою задачу и примените к ней материал курса. Если задача большая, уменьшите её до действия на 10 минут.`,
    },
    {
      kind: 'question',
      title: 'Итог',
      body: `Объясните тему "${topic}" другому человеку простыми словами. Если объяснение распадается, вернитесь к шагу с картой темы.`,
    },
  ];

  while (baseSteps.length < stepCount) {
    baseSteps.splice(baseSteps.length - 1, 0, {
      kind: baseSteps.length % 2 === 0 ? 'material' : 'practice',
      title: `Уточнение ${baseSteps.length}`,
      body: `Добавьте отдельный короткий шаг по теме "${topic}", который закрывает один частый вопрос ученика.`,
    });
  }

  return {
    title: titleFromTopic(topic),
    description: `Короткий курс, который помогает разобраться в теме "${topic}" через материалы, практику и самопроверку.`,
    steps: baseSteps.slice(0, stepCount),
  };
};

const lastUserMessage = (messages: CourseAuthoringMessage[]) =>
  [...messages].reverse().find((message) => message.role === 'user')?.content.trim() ?? '';

const extractTopic = (prompt: string) => {
  const cleaned = prompt
    .replace(/\s+/g, ' ')
    .replace(/^создай(те)?\s+/i, '')
    .replace(/^сделай(те)?\s+/i, '')
    .trim();
  return cleaned.length > 90 ? `${cleaned.slice(0, 87).trim()}...` : cleaned || 'новая тема';
};

const extractStepCount = (prompt: string) => {
  const match = prompt.match(/(\d{1,2})\s*(шаг|урок|lesson|step)/i);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(12, Math.max(3, parsed));
};

const titleFromTopic = (topic: string) => {
  const normalized = topic.replace(/[.!?]+$/g, '').trim();
  if (!normalized) return 'Новый курс';
  return normalized.toLowerCase().startsWith('курс')
    ? normalized
    : `Курс: ${normalized}`;
};

const formatDraftMessage = (draft: CourseDraft, intro: string) => {
  const stepList = draft.steps
    .slice(0, 6)
    .map((step, index) => `${index + 1}. ${step.title}`)
    .join('\n');
  const suffix = draft.steps.length > 6 ? `\n...и ещё ${draft.steps.length - 6}` : '';
  return `${intro}\n\n${draft.title}\n${draft.description ?? ''}\n\n${stepList}${suffix}`.trim();
};

const extractFencedJsonBlocks = (text: string) => {
  const blocks: string[] = [];
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match[1]?.trim()) {
      blocks.push(match[1].trim());
    }
  }
  return blocks;
};

const extractFirstJsonObject = (text: string) => {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }
  return null;
};
