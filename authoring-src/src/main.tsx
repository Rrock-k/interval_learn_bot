import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChatContainer,
  MainContainer,
  Message,
  MessageInput,
  MessageList,
  TypingIndicator,
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import './styles.css';

type ChatRole = 'user' | 'assistant';
type StepKind = 'material' | 'practice' | 'question';

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type CourseDraftStep = {
  kind: StepKind;
  title: string;
  body: string;
};

type CourseDraft = {
  title: string;
  description: string | null;
  steps: CourseDraftStep[];
};

const starterDraft: CourseDraft = {
  title: '',
  description: '',
  steps: [],
};

const initialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Опишите курс: тема, аудитория, результат и желаемое число шагов. Я соберу черновик справа.',
  },
];

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState<CourseDraft>(starterDraft);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [provider, setProvider] = useState<string>('not_started');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = useMemo(
    () => draft.title.trim().length > 0 && draft.steps.some((step) => step.title.trim() && step.body.trim()),
    [draft],
  );

  const sendMessage = async (_innerHtml: string, textContent: string) => {
    const text = textContent.trim();
    if (!text || isGenerating) return;
    const nextMessages = [...messages, { id: createId(), role: 'user' as const, content: text }];
    setMessages(nextMessages);
    setIsGenerating(true);
    setError(null);
    try {
      const result = await apiPost<{
        data: {
          assistantMessage: string;
          draft: CourseDraft;
          provider: string;
        };
      }>('/api/course-authoring/generate', {
        messages: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      setProvider(result.data.provider);
      setDraft(result.data.draft);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          content: result.data.assistantMessage,
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сгенерировать курс';
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          content: message,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const createCourse = async () => {
    if (!canCreate || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const result = await apiPost<{
        data: { course: { publicSlug: string | null; visibility: 'public' | 'private' } };
      }>('/api/course-authoring/courses', {
        visibility,
        draft,
      });
      const course = result.data.course;
      if (course.visibility === 'public' && course.publicSlug) {
        window.location.href = `/courses/${encodeURIComponent(course.publicSlug)}`;
        return;
      }
      window.location.href = '/my/courses';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать курс');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="authoring-shell">
      <header className="topbar">
        <div>
          <p>Course Authoring</p>
          <h1>Создание курса с LLM</h1>
        </div>
        <nav>
          <a href="/courses">Маркетплейс</a>
          <a href="/my/courses">Мои курсы</a>
          <a href="/account">Аккаунт</a>
        </nav>
      </header>

      <section className="workspace">
        <div className="chat-pane">
          <MainContainer responsive>
            <ChatContainer>
              <MessageList typingIndicator={isGenerating ? <TypingIndicator content="Собираю черновик курса" /> : null}>
                {messages.map((message) => (
                  <Message
                    key={message.id}
                    model={{
                      message: message.content,
                      direction: message.role === 'user' ? 'outgoing' : 'incoming',
                      position: 'single',
                    }}
                  />
                ))}
              </MessageList>
              <MessageInput
                attachButton={false}
                placeholder="Например: курс по SQL для маркетолога на 7 шагов"
                disabled={isGenerating}
                onSend={sendMessage}
              />
            </ChatContainer>
          </MainContainer>
        </div>

        <CourseDraftPanel
          draft={draft}
          provider={provider}
          visibility={visibility}
          isCreating={isCreating}
          canCreate={canCreate}
          error={error}
          onDraftChange={setDraft}
          onVisibilityChange={setVisibility}
          onCreate={() => void createCourse()}
        />
      </section>
    </main>
  );
}

function CourseDraftPanel({
  draft,
  provider,
  visibility,
  isCreating,
  canCreate,
  error,
  onDraftChange,
  onVisibilityChange,
  onCreate,
}: {
  draft: CourseDraft;
  provider: string;
  visibility: 'public' | 'private';
  isCreating: boolean;
  canCreate: boolean;
  error: string | null;
  onDraftChange: (draft: CourseDraft) => void;
  onVisibilityChange: (value: 'public' | 'private') => void;
  onCreate: () => void;
}) {
  const updateStep = (index: number, patch: Partial<CourseDraftStep>) => {
    onDraftChange({
      ...draft,
      steps: draft.steps.map((step, currentIndex) =>
        currentIndex === index ? { ...step, ...patch } : step,
      ),
    });
  };

  const removeStep = (index: number) => {
    onDraftChange({
      ...draft,
      steps: draft.steps.filter((_step, currentIndex) => currentIndex !== index),
    });
  };

  const addStep = () => {
    onDraftChange({
      ...draft,
      steps: [
        ...draft.steps,
        {
          kind: 'material',
          title: '',
          body: '',
        },
      ],
    });
  };

  return (
    <aside className="draft-pane">
      <div className="draft-heading">
        <div>
          <p>Черновик</p>
          <h2>{draft.title || 'Курс ещё не собран'}</h2>
        </div>
        <span>{providerLabel(provider)}</span>
      </div>

      <label className="field">
        <span>Название</span>
        <input
          value={draft.title}
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
          placeholder="Название курса"
        />
      </label>

      <label className="field">
        <span>Описание</span>
        <textarea
          rows={3}
          value={draft.description ?? ''}
          onChange={(event) => onDraftChange({ ...draft, description: event.target.value || null })}
          placeholder="Что ученик сможет сделать после курса"
        />
      </label>

      <div className="visibility">
        <button className={visibility === 'public' ? 'selected' : ''} onClick={() => onVisibilityChange('public')}>
          Публичный
        </button>
        <button className={visibility === 'private' ? 'selected' : ''} onClick={() => onVisibilityChange('private')}>
          Приватный
        </button>
      </div>

      <div className="steps-header">
        <h3>{draft.steps.length} шагов</h3>
        <button type="button" onClick={addStep}>Добавить шаг</button>
      </div>

      <div className="steps-list">
        {draft.steps.length === 0 ? (
          <div className="empty-state">
            Напишите в чат, какой курс нужен. Черновик появится здесь.
          </div>
        ) : null}
        {draft.steps.map((step, index) => (
          <article className="step-editor" key={`${index}-${step.title}`}>
            <div className="step-topline">
              <span>{index + 1}</span>
              <select value={step.kind} onChange={(event) => updateStep(index, { kind: event.target.value as StepKind })}>
                <option value="material">Материал</option>
                <option value="practice">Практика</option>
                <option value="question">Вопрос</option>
              </select>
              <button type="button" onClick={() => removeStep(index)}>Удалить</button>
            </div>
            <input
              value={step.title}
              onChange={(event) => updateStep(index, { title: event.target.value })}
              placeholder="Название шага"
            />
            <textarea
              rows={5}
              value={step.body}
              onChange={(event) => updateStep(index, { body: event.target.value })}
              placeholder="Текст карточки"
            />
          </article>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}

      <button className="create-button" disabled={!canCreate || isCreating} onClick={onCreate}>
        {isCreating ? 'Создаю...' : 'Создать курс'}
      </button>
    </aside>
  );
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error('Не удалось подключиться к API создания курса. Обновите страницу или откройте /courses/author через основной сервер приложения.');
  }
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Сессия истекла. Войдите снова через личный кабинет.');
    }
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }
  return payload as T;
}

const providerLabel = (provider: string) => {
  if (provider === 'openai_compatible') return 'LLM';
  if (provider === 'local_fallback') return 'Локальный черновик';
  return 'Ожидает запроса';
};

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

createRoot(document.getElementById('root')!).render(<App />);
