import { Fragment, useEffect, useRef, useState, useMemo, type CSSProperties } from 'react';
import {
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clipboard,
  Clock3,
  Copy,
  Link2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from './components/ui';
import { cn } from './lib/utils';
import { buildMessageLink, getMessageLink } from './linkUtils';

type CardStatus = 'pending' | 'learning' | 'awaiting_grade' | 'archived';
type ViewName = 'queue' | 'courses' | 'cards' | 'calendar' | 'stats' | 'balance' | 'card-detail' | 'notification-detail';
type SortMode = 'nextReviewAsc' | 'nextReviewDesc' | 'updatedDesc' | 'repetitionDesc';
type NotificationReason = 'scheduled' | 'manual_now' | 'manual_override' | 'one_time';

type CardRecord = {
  id: string;
  userId?: string;
  sourceChatId: string;
  sourceMessageId: number;
  contentType: string;
  contentPreview: string | null;
  contentFileId?: string | null;
  reminderMode?: string;
  scheduleRule?: string | null;
  status: CardStatus;
  repetition: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  pendingChannelId: string | null;
  pendingChannelMessageId: number | null;
  baseChannelMessageId: number | null;
  awaitingGradeSince: string | null;
  lastNotificationAt: string | null;
  lastNotificationReason: NotificationReason | null;
  lastNotificationMessageId: number | null;
  createdAt: string;
  updatedAt: string;
};

type Stats = {
  total: number;
  dueToday: number;
  pending: number;
  learning: number;
  awaitingGrade: number;
  archived: number;
};

type ReminderSettings = {
  timezone: string;
  activeHoursStart: number;
  activeHoursEnd: number;
  minGapMinutes: number;
};

type MiniAppProfile = {
  userId: string;
  ownerTools: boolean;
};

type RebalanceChange = {
  id: string;
  jobId: string;
  cardId: string;
  contentPreview: string | null;
  dueAt: string;
  beforeScheduledAt: string;
  afterScheduledAt: string;
  deltaMinutes: number;
};

type RebalancePreview = {
  planToken: string;
  generatedAt: string;
  horizonDays: number;
  bucketMinutes: number;
  settings: ReminderSettings;
  range: { start: string; end: string };
  metrics: {
    total: number;
    moved: number;
    maxBucketBefore: number;
    maxBucketAfter: number;
    conflictCountBefore: number;
    conflictCountAfter: number;
    averageDeltaMinutes: number;
    maxDeltaMinutes: number;
  };
  heatmap: {
    days: string[];
    dayLabels: string[];
    slots: string[];
    before: number[][];
    after: number[][];
  };
  changes: RebalanceChange[];
};

type ReminderJobRecord = {
  id: string;
  cardId: string;
  userId: string;
  kind: 'review' | 'one_time' | 'manual_now';
  status: 'pending' | 'sending' | 'awaiting_action' | 'completed' | 'snoozed' | 'cancelled' | 'failed';
  dueAt: string;
  scheduledAt: string;
  sentAt: string | null;
  completedAt: string | null;
};

type ReminderQueueItem = {
  id: string;
  kind: 'awaiting_review' | 'one_time' | 'scheduled_review';
  card: CardRecord;
  job: ReminderJobRecord | null;
  availableAt: string | null;
  isDue: boolean;
};

type QueueAction = 'viewed' | 'not-viewed' | 'again' | 'reschedule' | 'archive';

type CourseStepKind = 'material' | 'practice' | 'question';

type CourseSummary = {
  id: string;
  ownerUserId: string;
  title: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  stepCount: number;
  activeEnrollmentCount: number;
  completedEnrollmentCount: number;
  createdAt: string;
  updatedAt: string;
};

type CourseStepDraft = {
  kind: CourseStepKind;
  title: string;
  body: string;
};

type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id?: number | string } };
  themeParams?: Record<string, string>;
  ready?: () => void;
  expand?: () => void;
  showAlert?: (message: string) => void;
  openTelegramLink?: (url: string) => void;
  onEvent?: (event: string, callback: () => void) => void;
  HapticFeedback?: { notificationOccurred?: (type: 'success' | 'warning' | 'error') => void };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const fallbackTg: TelegramWebApp = {
  initData: '',
  initDataUnsafe: {},
  themeParams: {},
  ready() {},
  expand() {},
  showAlert(message) {
    window.alert(message);
  },
};

const tg = window.Telegram?.WebApp || fallbackTg;

const statusLabel: Record<CardStatus, string> = {
  pending: 'Ожидает',
  learning: 'Изучается',
  awaiting_grade: 'Ждёт оценки',
  archived: 'Архив',
};

const statusTone: Record<CardStatus, 'muted' | 'default' | 'inverse'> = {
  pending: 'muted',
  learning: 'default',
  awaiting_grade: 'inverse',
  archived: 'muted',
};

const notificationReasonLabel: Record<NotificationReason, string> = {
  scheduled: 'по расписанию',
  manual_now: 'вручную',
  manual_override: 'дата вручную',
  one_time: 'одноразовое',
};

const demoCards: CardRecord[] = [
  {
    id: 'bd2a193e-ee12-49b0-8845-3d4aa27dfab9',
    sourceChatId: '359367655',
    sourceMessageId: 1603,
    contentType: 'text',
    contentPreview: 'https://www.instagram.com/p/DXcxc8EDLU2/?igsh=MXR5c3RjY2J5aHI5bA==',
    status: 'awaiting_grade',
    repetition: 4,
    nextReviewAt: '2026-04-25T23:19:00.000Z',
    lastReviewedAt: '2026-04-24T13:04:00.000Z',
    pendingChannelId: '359367655',
    pendingChannelMessageId: 1763,
    baseChannelMessageId: 1764,
    awaitingGradeSince: '2026-04-28T20:21:53.000Z',
    lastNotificationAt: '2026-04-28T20:21:53.000Z',
    lastNotificationReason: 'manual_now',
    lastNotificationMessageId: 1763,
    createdAt: '2026-04-24T10:04:00.000Z',
    updatedAt: '2026-04-28T20:21:53.000Z',
  },
  {
    id: '8f54d9c4-4ad6-4bd5-9461-4b5807a7bb19',
    sourceChatId: '359367655',
    sourceMessageId: 1710,
    contentType: 'text',
    contentPreview: 'Короткая текстовая заметка без ссылки, чтобы проверить вертикальные интервалы и плотность карточек.',
    status: 'learning',
    repetition: 1,
    nextReviewAt: '2026-04-30T09:10:00.000Z',
    lastReviewedAt: null,
    pendingChannelId: null,
    pendingChannelMessageId: null,
    baseChannelMessageId: null,
    awaitingGradeSince: null,
    lastNotificationAt: null,
    lastNotificationReason: null,
    lastNotificationMessageId: null,
    createdAt: '2026-04-26T09:00:00.000Z',
    updatedAt: '2026-04-26T09:00:00.000Z',
  },
  {
    id: '14f9fb42-720e-4dbd-b3d7-c22de2830f1d',
    sourceChatId: '359367655',
    sourceMessageId: 1731,
    contentType: 'text',
    contentPreview: 'Разобрать заметки по проекту и вынести повторяемые правила в короткий список.',
    status: 'pending',
    repetition: 0,
    nextReviewAt: null,
    lastReviewedAt: null,
    pendingChannelId: null,
    pendingChannelMessageId: null,
    baseChannelMessageId: null,
    awaitingGradeSince: null,
    lastNotificationAt: null,
    lastNotificationReason: null,
    lastNotificationMessageId: null,
    createdAt: '2026-04-28T11:00:00.000Z',
    updatedAt: '2026-04-28T11:00:00.000Z',
  },
];

const demoReminderSettings: ReminderSettings = {
  timezone: 'Asia/Tbilisi',
  activeHoursStart: 10 * 60,
  activeHoursEnd: 22 * 60,
  minGapMinutes: 30,
};

const demoCourses: CourseSummary[] = [
  {
    id: 'demo-course-sql',
    ownerUserId: 'demo',
    title: 'Основы SQL',
    description: 'Короткий курс из практических шагов.',
    status: 'active',
    stepCount: 4,
    activeEnrollmentCount: 0,
    completedEnrollmentCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const isDemoMode = () => new URLSearchParams(window.location.search).has('demo');

const showAlert = (message: string) => tg.showAlert?.(message) || window.alert(message);

const parseStartParam = () => {
  const params = new URLSearchParams(window.location.search);
  const raw =
    tg.initDataUnsafe?.start_param ||
    params.get('tgWebAppStartParam') ||
    params.get('startapp') ||
    params.get('start_param');
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.startsWith('card_')) return { type: 'card' as const, cardId: decoded.slice(5) };
  if (decoded.startsWith('notification_')) return { type: 'notification' as const, cardId: decoded.slice(13) };
  if (decoded.startsWith('view_')) return { type: 'view' as const, view: decoded.slice(5) as ViewName };
  return null;
};

const formatDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatDateShort = (iso?: string | null) => {
  if (!iso) return 'Без даты';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Без даты';
  return date.toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const formatTimeOnly = (iso?: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
};

const toDatetimeLocalValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const parseDatetimeLocalValue = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  return date.toISOString();
};

const minutesToTimeValue = (minutes: number) => {
  const normalized = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const timeValueToMinutes = (value: string) => {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
};

const toDateKey = (value: string | Date) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const safeDate = (iso?: string | null, fallback = Number.POSITIVE_INFINITY) => {
  const ms = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : fallback;
};

async function copyText(value: string) {
  if (!value.trim()) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
}

export function App() {
  const [view, setView] = useState<ViewName>('queue');
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [queueItems, setQueueItems] = useState<ReminderQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [profile, setProfile] = useState<MiniAppProfile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [rebalancePreview, setRebalancePreview] = useState<RebalancePreview | null>(null);
  const [rebalanceError, setRebalanceError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CardStatus | 'all'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('nextReviewAsc');
  const [query, setQuery] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; label: string; danger?: boolean; action: () => Promise<void> }>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const demo = isDemoMode();
  const ownerToolsAvailable = demo || profile?.ownerTools === true || profile === null;
  const screenTitle =
    view === 'card-detail'
      ? 'Карточка'
      : view === 'notification-detail'
        ? 'Уведомление'
        : view === 'balance'
          ? 'Распределение'
        : view === 'courses'
          ? 'Курсы'
        : view === 'calendar'
          ? 'Календарь'
        : view === 'stats'
            ? 'Статистика'
            : view === 'queue'
              ? 'Очередь'
              : 'Мои карточки';
  const screenSubtitle =
    view === 'queue'
      ? 'Потяните следующую карточку, когда готовы посмотреть.'
      : view === 'courses'
        ? 'Создайте простой курс и запустите шаги в очередь.'
      : view === 'calendar'
      ? 'Ближайшие повторения по дням.'
      : view === 'stats'
        ? 'Короткая сводка по прогрессу.'
        : view === 'balance'
          ? 'Визуальная проверка расписания до применения.'
        : view === 'card-detail'
          ? 'Содержимое, расписание и действия.'
          : view === 'notification-detail'
            ? 'Что отправлено и к какой карточке относится.'
            : 'Повторения, календарь и прогресс.';

  useEffect(() => {
    tg.ready?.();
    tg.expand?.();
    document.documentElement.dataset.theme = 'dark';
    const font = new URLSearchParams(window.location.search).get('font') || 'a';
    document.documentElement.dataset.font = ['a', 'b', 'c', 'tt', 'wix'].includes(font) ? font : 'wix';
  }, []);

  const apiCall = async <T,>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    if (demo) {
      return demoResponse<T>(endpoint, options, cards, setCards, courses, setCourses);
    }
    if (!tg.initData) throw new Error('Telegram initData не доступен. Откройте приложение через бота.');
    const response = await fetch(`${window.location.origin}${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData, ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  };

  const loadCards = async (filter: CardStatus | 'all' = statusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const suffix = filter !== 'all' ? `?status=${filter}` : '';
      const result = await apiCall<{ data: CardRecord[] }>(`/api/miniapp/cards${suffix}`);
      setCards(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadQueue = async () => {
    if (!ownerToolsAvailable) return;
    setQueueLoading(true);
    setQueueError(null);
    try {
      const result = await apiCall<{ data: { items: ReminderQueueItem[] } }>('/api/miniapp/queue?limit=20');
      setQueueItems(result.data.items || []);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueLoading(false);
    }
  };

  const loadCourses = async () => {
    if (!ownerToolsAvailable) return;
    setCoursesLoading(true);
    setCoursesError(null);
    try {
      const result = await apiCall<{ data: CourseSummary[] }>('/api/miniapp/courses');
      setCourses(result.data || []);
    } catch (err) {
      setCoursesError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoursesLoading(false);
    }
  };

  const loadProfile = async () => {
    if (demo) {
      setProfile({ userId: String(tg.initDataUnsafe?.user?.id ?? 'demo'), ownerTools: true });
      return;
    }
    try {
      const result = await apiCall<{ data: MiniAppProfile }>('/api/miniapp/me');
      setProfile(result.data);
    } catch {
      setProfile({ userId: '', ownerTools: false });
    }
  };

  const loadStats = async () => {
    setStatsError(null);
    if (demo) {
      setStats(buildStats(cards.length ? cards : demoCards));
      return;
    }
    try {
      const result = await apiCall<{ data: Stats }>('/api/miniapp/stats');
      setStats(result.data);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadReminderSettings = async () => {
    setSettingsError(null);
    if (demo) {
      setReminderSettings(demoReminderSettings);
      return;
    }
    try {
      const result = await apiCall<{ data: ReminderSettings }>('/api/miniapp/settings/reminders');
      setReminderSettings(result.data);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void loadProfile();
    void loadCards('all');
  }, []);

  useEffect(() => {
    const deepLink = parseStartParam();
    if (!deepLink || loading || !cards.length) return;
    if (deepLink.type === 'card') {
      setSelectedCardId(deepLink.cardId);
      setView('card-detail');
    }
    if (deepLink.type === 'notification') {
      setSelectedCardId(deepLink.cardId);
      setView('notification-detail');
    }
    if (deepLink.type === 'view' && ['queue', 'courses', 'cards', 'calendar', 'stats', 'balance'].includes(deepLink.view)) {
      setView(deepLink.view);
    }
  }, [loading, cards.length]);

  useEffect(() => {
    if (view === 'stats') {
      void loadStats();
      void loadReminderSettings();
    }
  }, [view]);

  useEffect(() => {
    if ((view === 'balance' || view === 'queue' || view === 'courses') && profile && !profile.ownerTools) {
      setView('cards');
    }
  }, [profile, view]);

  useEffect(() => {
    if (view === 'queue' && ownerToolsAvailable) {
      void loadQueue();
    }
  }, [view, profile?.ownerTools]);

  useEffect(() => {
    if (view === 'courses' && ownerToolsAvailable) {
      void loadCourses();
    }
  }, [view, profile?.ownerTools]);

  const visibleCards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = cards.filter((card) => {
      if (statusFilter !== 'all' && card.status !== statusFilter) return false;
      if (!normalized) return true;
      return (card.contentPreview || '').toLowerCase().includes(normalized) || card.id.toLowerCase().includes(normalized);
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === 'nextReviewDesc') return safeDate(b.nextReviewAt, -1) - safeDate(a.nextReviewAt, -1);
      if (sortMode === 'updatedDesc') return safeDate(b.updatedAt, -1) - safeDate(a.updatedAt, -1);
      if (sortMode === 'repetitionDesc') return Number(b.repetition || 0) - Number(a.repetition || 0);
      return safeDate(a.nextReviewAt) - safeDate(b.nextReviewAt);
    });
  }, [cards, query, sortMode, statusFilter]);

  const selectedCard = useMemo(() => cards.find((card) => card.id === selectedCardId) || null, [cards, selectedCardId]);
  const scheduledCards = useMemo(() => cards.filter((card) => card.status === 'learning' && card.nextReviewAt), [cards]);

  const openCard = (card: CardRecord) => {
    setSelectedCardId(card.id);
    setView('card-detail');
  };

  const updateStatus = async (card: CardRecord, status: CardStatus) => {
    setBusyKey(`status:${card.id}`);
    try {
      if (!demo) {
        await apiCall(`/api/miniapp/cards/${card.id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      }
      const updatedAt = new Date().toISOString();
      setCards((items) => items.map((item) => (item.id === card.id ? { ...item, status, updatedAt } : item)));
    } finally {
      setBusyKey(null);
    }
  };

  const requestArchive = (card: CardRecord) => {
    const archived = card.status === 'archived';
    setConfirm({
      title: archived ? 'Разархивировать карточку?' : 'Архивировать карточку?',
      body: archived ? 'Карточка вернётся в активные списки.' : 'Карточка будет скрыта из активного расписания.',
      label: archived ? 'Разархивировать' : 'Архивировать',
      danger: !archived,
      action: () => updateStatus(card, archived ? 'learning' : 'archived'),
    });
  };

  const requestReminder = (card: CardRecord) => {
    setConfirm({
      title: 'Отправить напоминание?',
      body: 'Бот сразу отправит напоминание по этой карточке в Telegram.',
      label: 'Отправить',
      action: async () => {
        setBusyKey(`reminder:${card.id}`);
        try {
          if (!demo) await apiCall(`/api/miniapp/cards/${card.id}/send-reminder`, { method: 'POST' });
          const sentAt = new Date().toISOString();
          setCards((items) =>
            items.map((item) =>
              item.id === card.id
                ? { ...item, status: 'awaiting_grade', awaitingGradeSince: sentAt, lastNotificationAt: sentAt, lastNotificationReason: 'manual_now' }
                : item,
            ),
          );
          tg.HapticFeedback?.notificationOccurred?.('success');
          showAlert('Напоминание отправлено');
        } finally {
          setBusyKey(null);
        }
      },
    });
  };

  const requestOneTimeReminder = async (card: CardRecord, remindAt: string) => {
    setBusyKey(`one-time:${card.id}`);
    try {
      if (!demo) {
        await apiCall(`/api/miniapp/cards/${card.id}/one-time-reminder`, {
          method: 'POST',
          body: JSON.stringify({ remindAt }),
        });
      }
      tg.HapticFeedback?.notificationOccurred?.('success');
      showAlert('Одноразовое напоминание назначено');
    } finally {
      setBusyKey(null);
    }
  };

  const saveReminderSettings = async (settings: ReminderSettings) => {
    setBusyKey('settings:reminders');
    try {
      if (!demo) {
        const result = await apiCall<{ data: ReminderSettings }>('/api/miniapp/settings/reminders', {
          method: 'POST',
          body: JSON.stringify(settings),
        });
        setReminderSettings(result.data);
      } else {
        setReminderSettings(settings);
      }
      tg.HapticFeedback?.notificationOccurred?.('success');
      showAlert('Настройки напоминаний сохранены');
    } finally {
      setBusyKey(null);
    }
  };

  const buildRebalancePreview = async (options: { horizonDays: number; bucketMinutes: number }) => {
    setBusyKey('rebalance:preview');
    setRebalanceError(null);
    try {
      const result = await apiCall<{ data: RebalancePreview }>('/api/miniapp/reminders/rebalance/preview', {
        method: 'POST',
        body: JSON.stringify(options),
      });
      setRebalancePreview(result.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось построить план';
      setRebalanceError(message);
      throw err;
    } finally {
      setBusyKey(null);
    }
  };

  const applyRebalancePreview = async () => {
    if (!rebalancePreview) return;
    setBusyKey('rebalance:apply');
    try {
      const result = await apiCall<{ data: { updated: number } }>('/api/miniapp/reminders/rebalance/apply', {
        method: 'POST',
        body: JSON.stringify({
          planToken: rebalancePreview.planToken,
          changes: rebalancePreview.changes,
        }),
      });
      tg.HapticFeedback?.notificationOccurred?.('success');
      showAlert(`Расписание обновлено: ${result.data.updated}`);
      setRebalancePreview(null);
      await loadCards('all');
    } finally {
      setBusyKey(null);
    }
  };

  const runQueueAction = async (
    item: ReminderQueueItem,
    action: QueueAction,
    payload: Record<string, unknown> = {},
  ) => {
    const busy = `queue:${action}:${item.card.id}`;
    setBusyKey(busy);
    try {
      await apiCall(`/api/miniapp/queue/cards/${item.card.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          jobId: item.job?.id,
          ...payload,
        }),
      });
      if (action === 'viewed') {
        setQueueItems((items) => items.filter((entry) => entry.id !== item.id));
      }
      if (action !== 'not-viewed') {
        tg.HapticFeedback?.notificationOccurred?.('success');
      }
      await loadQueue();
      await loadCards('all');
    } finally {
      setBusyKey(null);
    }
  };

  const createCourse = async (input: { title: string; description: string | null; steps: CourseStepDraft[] }) => {
    setBusyKey('course:create');
    try {
      await apiCall('/api/miniapp/courses', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      tg.HapticFeedback?.notificationOccurred?.('success');
      showAlert('Курс создан');
      await loadCourses();
    } finally {
      setBusyKey(null);
    }
  };

  const startCourse = async (course: CourseSummary) => {
    setBusyKey(`course:start:${course.id}`);
    try {
      await apiCall(`/api/miniapp/courses/${course.id}/start`, {
        method: 'POST',
        body: JSON.stringify({ cadence: 'after_view' }),
      });
      tg.HapticFeedback?.notificationOccurred?.('success');
      showAlert('Первый шаг добавлен в очередь');
      await loadCourses();
      await loadQueue();
    } finally {
      setBusyKey(null);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const action = confirm.action;
    setConfirm(null);
    try {
      await action();
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Не удалось выполнить действие');
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-kicker">Интервальное повторение</p>
          <h1>{screenTitle}</h1>
          <p>{screenSubtitle}</p>
        </div>
      </header>

      {view !== 'card-detail' && view !== 'notification-detail' ? (
        <Tabs value={view} onValueChange={(value) => setView(value as ViewName)} className="app-tabs">
          <TabsList className={ownerToolsAvailable ? 'tabs-count-6' : undefined}>
            {ownerToolsAvailable ? <TabsTrigger value="queue">Очередь</TabsTrigger> : null}
            {ownerToolsAvailable ? <TabsTrigger value="courses">Курсы</TabsTrigger> : null}
            <TabsTrigger value="cards">Карточки</TabsTrigger>
            <TabsTrigger value="calendar">Календарь</TabsTrigger>
            <TabsTrigger value="stats">Статистика</TabsTrigger>
            {ownerToolsAvailable ? <TabsTrigger value="balance">Баланс</TabsTrigger> : null}
          </TabsList>
        </Tabs>
      ) : null}

      <main className="app-main" key={view}>
        {view === 'queue' && ownerToolsAvailable ? (
          <QueueScreen
            items={queueItems}
            loading={queueLoading}
            error={queueError}
            busyKey={busyKey}
            onReload={loadQueue}
            onAction={runQueueAction}
            onOpen={(card) => {
              setSelectedCardId(card.id);
              setView('card-detail');
            }}
          />
        ) : null}

        {view === 'courses' && ownerToolsAvailable ? (
          <CoursesScreen
            courses={courses}
            loading={coursesLoading}
            error={coursesError}
            busyKey={busyKey}
            onCreate={createCourse}
            onStart={startCourse}
            onReload={loadCourses}
          />
        ) : null}

        {view === 'cards' ? (
          <CardsScreen
            cards={visibleCards}
            allCards={cards}
            loading={loading}
            error={error}
            query={query}
            setQuery={setQuery}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            sortMode={sortMode}
            setSortMode={setSortMode}
            reload={() => loadCards(statusFilter)}
            reset={() => {
              setStatusFilter('all');
              setSortMode('nextReviewAsc');
              setQuery('');
              void loadCards('all');
            }}
            onOpen={openCard}
            onArchive={requestArchive}
            onReminder={requestReminder}
            busyKey={busyKey}
          />
        ) : null}

        {view === 'card-detail' && selectedCard ? (
          <CardDetail
            card={selectedCard}
            onBack={() => setView('cards')}
            onReminder={requestReminder}
            onOneTimeReminder={requestOneTimeReminder}
            onArchive={requestArchive}
            busyKey={busyKey}
          />
        ) : null}

        {view === 'notification-detail' && selectedCard ? <NotificationDetail card={selectedCard} onBack={() => setView('cards')} /> : null}

        {view === 'calendar' ? (
          <CalendarScreen cards={scheduledCards} month={calendarMonth} setMonth={setCalendarMonth} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onOpen={openCard} />
        ) : null}

        {view === 'stats' ? (
          <StatsScreen
            stats={stats || buildStats(cards)}
            loading={!stats && !statsError}
            error={statsError}
            reminderSettings={reminderSettings}
            settingsError={settingsError}
            settingsSaving={busyKey === 'settings:reminders'}
            onSaveReminderSettings={saveReminderSettings}
          />
        ) : null}

        {view === 'balance' && profile?.ownerTools ? (
          <RebalanceScreen
            preview={rebalancePreview}
            error={rebalanceError}
            busyKey={busyKey}
            onPreview={buildRebalancePreview}
            onApply={() =>
              setConfirm({
                title: 'Применить новое расписание?',
                body: 'Будущие review-напоминания будут перенесены по показанному варианту.',
                label: 'Применить',
                action: applyRebalancePreview,
              })
            }
            onReset={() => setRebalancePreview(null)}
          />
        ) : null}
      </main>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>{confirm?.title}</DialogTitle>
          <DialogDescription>{confirm?.body}</DialogDescription>
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setConfirm(null)}>Отмена</Button>
            <Button variant={confirm?.danger ? 'destructive' : 'default'} onClick={runConfirm}>{confirm?.label}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const QUEUE_PULL_THRESHOLD = 0.45;

function CoursesScreen({
  courses,
  loading,
  error,
  busyKey,
  onCreate,
  onStart,
  onReload,
}: {
  courses: CourseSummary[];
  loading: boolean;
  error: string | null;
  busyKey: string | null;
  onCreate: (input: { title: string; description: string | null; steps: CourseStepDraft[] }) => Promise<void>;
  onStart: (course: CourseSummary) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stepsText, setStepsText] = useState('');
  const parsedSteps = useMemo(() => parseCourseStepsDraft(stepsText), [stepsText]);
  const creating = busyKey === 'course:create';
  const canCreate = title.trim().length > 0 && parsedSteps.length > 0;

  const submit = async () => {
    if (!canCreate) {
      showAlert('Добавьте название и хотя бы один шаг');
      return;
    }
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || null,
        steps: parsedSteps,
      });
      setTitle('');
      setDescription('');
      setStepsText('');
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Не удалось создать курс');
    }
  };

  return (
    <div className="courses-stack">
      <Card className="course-editor">
        <div className="settings-heading">
          <div>
            <h2>Новый курс</h2>
            <p>Каждый блок станет отдельным шагом очереди.</p>
          </div>
          <BookOpen size={20} />
        </div>
        <label className="settings-field">
          <span>Название</span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Основы SQL" />
        </label>
        <label className="settings-field">
          <span>Описание</span>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Коротко, чему учимся" />
        </label>
        <label className="settings-field">
          <span>Шаги</span>
          <textarea
            className="ui-textarea"
            value={stepsText}
            onChange={(event) => setStepsText(event.target.value)}
            placeholder={'JOIN руками\nСоберите запрос с INNER JOIN на двух таблицах.\n\nGROUP BY\nСгруппируйте продажи по дням.'}
          />
        </label>
        <div className="course-editor-footer">
          <Badge tone="muted">{parsedSteps.length} шагов</Badge>
          <Button disabled={creating || !canCreate} onClick={() => void submit()}>
            <Plus size={16} />
            Создать
          </Button>
        </div>
      </Card>

      <div className="queue-topline">
        <Badge tone="muted">{loading ? 'Обновление' : `${courses.length} курсов`}</Badge>
        <Button variant="ghost" size="icon" aria-label="Обновить курсы" disabled={loading} onClick={() => void onReload()}>
          <RotateCcw size={16} />
        </Button>
      </div>

      {error ? <StateBlock title="Не удалось загрузить курсы" body={error} /> : null}
      {!error && !loading && courses.length === 0 ? <StateBlock title="Курсов пока нет" body="Создайте первый простой курс из нескольких шагов." /> : null}

      {courses.map((course) => {
        const starting = busyKey === `course:start:${course.id}`;
        const started = course.activeEnrollmentCount > 0;
        return (
          <Card className="course-row" key={course.id}>
            <div className="course-row-main">
              <div>
                <h2>{course.title}</h2>
                {course.description ? <p>{course.description}</p> : null}
              </div>
              <Badge tone={started ? 'inverse' : 'muted'}>{started ? 'В очереди' : course.status}</Badge>
            </div>
            <div className="course-row-meta">
              <span>{course.stepCount} шагов</span>
              <span>запусков {course.activeEnrollmentCount + course.completedEnrollmentCount}</span>
            </div>
            <Button variant="outline" disabled={starting || course.stepCount === 0} onClick={() => void onStart(course)}>
              <Play size={16} />
              {started ? 'Запустить ещё раз' : 'Запустить'}
            </Button>
          </Card>
        );
      })}
    </div>
  );
}

function QueueScreen({
  items,
  loading,
  error,
  busyKey,
  onReload,
  onAction,
  onOpen,
}: {
  items: ReminderQueueItem[];
  loading: boolean;
  error: string | null;
  busyKey: string | null;
  onReload: () => Promise<void>;
  onAction: (item: ReminderQueueItem, action: QueueAction, payload?: Record<string, unknown>) => Promise<void>;
  onOpen: (card: CardRecord) => void;
}) {
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewedItem, setViewedItem] = useState<ReminderQueueItem | null>(null);
  const [settling, setSettling] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | {
    startX: number;
    startY: number;
    startProgress: number;
    fullDrag: number;
    pointerId: number;
    mode: 'h' | 'v' | null;
  }>(null);
  const nextItem = items.find((item) => item.id !== viewedItem?.id) ?? null;
  const activePullItem = nextItem;
  const queueBusy = Boolean(busyKey?.startsWith('queue:'));

  const settleTo = (value: number) => {
    setSettling(true);
    setProgress(value);
    window.setTimeout(() => setSettling(false), 220);
  };

  const completePull = async (item: ReminderQueueItem) => {
    setMenuOpen(false);
    settleTo(1);
    window.setTimeout(() => {
      setViewedItem(item);
      setProgress(0);
    }, 180);
    try {
      await onAction(item, 'viewed');
    } catch (err) {
      setViewedItem(null);
      showAlert(err instanceof Error ? err.message : 'Не удалось отметить просмотр');
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activePullItem || queueBusy || menuOpen) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startProgress: progress,
      fullDrag: Math.max(180, rect.width * 0.72),
      pointerId: event.pointerId,
      mode: null,
    };
    setSettling(false);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // noop
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.mode === null) {
      const magnitude = Math.hypot(dx, dy);
      if (magnitude < 6) return;
      drag.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (drag.mode !== 'h') return;
    const raw = drag.startProgress + (-dx / drag.fullDrag);
    const rubber = raw < 0 ? raw * 0.25 : raw > 1 ? 1 + (raw - 1) * 0.18 : raw;
    setProgress(Math.max(-0.06, Math.min(1.08, rubber)));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // noop
    }
    if (drag.mode !== 'h') return;
    if (progress >= QUEUE_PULL_THRESHOLD && activePullItem) {
      void completePull(activePullItem);
    } else {
      settleTo(0);
    }
  };

  const menuAction = async (action: QueueAction, payload: Record<string, unknown> = {}) => {
    if (!viewedItem) return;
    try {
      if (action === 'archive') {
        await onAction(viewedItem, action, payload);
        setViewedItem(null);
      } else if (action === 'not-viewed') {
        await onAction(viewedItem, action, payload);
        setViewedItem(null);
      } else if (action === 'reschedule' || action === 'again') {
        await onAction(viewedItem, action, payload);
        setViewedItem(null);
      }
      setMenuOpen(false);
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Не удалось выполнить действие');
    }
  };

  if (error) {
    return <StateBlock title="Не удалось загрузить очередь" body={error} />;
  }

  return (
    <div className="queue-screen">
      <div className="queue-topline">
        <Badge tone="muted">{loading ? 'Обновление' : `${items.length}${viewedItem ? '+1' : ''}`}</Badge>
        <Button variant="ghost" size="icon" aria-label="Обновить очередь" disabled={loading} onClick={() => void onReload()}>
          <RotateCcw size={16} />
        </Button>
      </div>

      <div
        ref={stageRef}
        className={cn('queue-live-stage', settling && 'is-settling')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => menuOpen && setMenuOpen(false)}
      >
        {!viewedItem && !nextItem && !loading ? (
          <div className="queue-empty">
            <CheckCircle2 size={36} />
            <span>Очередь пуста</span>
          </div>
        ) : null}

        {viewedItem ? (
          <div
            className="queue-card-shell queue-card-current"
            style={{ '--queue-x': `${-progress * 108}%` } as CSSProperties}
          >
            <QueueReminderCard
              item={viewedItem}
              viewed
              menuOpen={menuOpen}
              onMenu={() => setMenuOpen((value) => !value)}
            />
          </div>
        ) : null}

        {nextItem ? (
          <div
            className="queue-card-shell queue-card-next"
            style={{ '--queue-x': `${94 - progress * 94}%` } as CSSProperties}
          >
            <QueueReminderCard
              item={nextItem}
              ghost={progress < 0.08}
              contentOpacity={Math.max(0, Math.min(1, (progress - 0.08) / 0.32))}
            />
          </div>
        ) : null}

        {nextItem ? <QueueProgressSpring progress={progress} /> : null}

        {progress >= QUEUE_PULL_THRESHOLD && nextItem ? (
          <div className="queue-release-label">Отпусти, чтобы просмотреть</div>
        ) : null}

        {menuOpen && viewedItem ? (
          <div className="queue-menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" disabled={queueBusy} onClick={() => void menuAction('not-viewed')}>Не просмотрено</button>
            <button type="button" disabled={queueBusy} onClick={() => void menuAction('reschedule', { minutes: 60 })}>Перенести</button>
            <button type="button" disabled={queueBusy} onClick={() => void menuAction('again')}>Снова</button>
            <button type="button" disabled={queueBusy} onClick={() => void menuAction('archive')}>Архив</button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpen(viewedItem.card);
              }}
            >
              Открыть детали
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QueueProgressSpring({ progress }: { progress: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, progress / QUEUE_PULL_THRESHOLD));
  const past = progress >= QUEUE_PULL_THRESHOLD;
  return (
    <div
      className={cn('queue-progress-spring', past && 'is-ready')}
      style={{
        opacity: Math.max(0, Math.min(1, (progress - 0.02) * 9)),
        transform: `translate(-50%, -50%) scale(${0.78 + 0.22 * filled + (past ? 0.06 : 0)})`,
      }}
    >
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={radius} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="3" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke={past ? '#f3f3ef' : '#b8c4d8'}
          strokeWidth={past ? 3.5 : 3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          transform="rotate(-90 28 28)"
        />
      </svg>
    </div>
  );
}

function QueueReminderCard({
  item,
  viewed = false,
  ghost = false,
  menuOpen = false,
  contentOpacity = 1,
  onMenu,
}: {
  item: ReminderQueueItem;
  viewed?: boolean;
  ghost?: boolean;
  menuOpen?: boolean;
  contentOpacity?: number;
  onMenu?: () => void;
}) {
  const label =
    item.kind === 'one_time'
      ? 'Одноразовое'
      : item.kind === 'scheduled_review'
        ? 'Дальше'
        : 'К оценке';
  return (
    <Card
      className={cn('queue-reminder-card', ghost && 'is-ghost')}
      style={{ '--queue-content-opacity': contentOpacity } as CSSProperties}
    >
      <div className="queue-card-header">
        <div>
          <Badge tone={item.isDue ? 'inverse' : 'muted'}>{label}</Badge>
          <span>{formatDateShort(item.availableAt || item.card.nextReviewAt)}</span>
        </div>
        {viewed ? (
          <button
            type="button"
            className={cn('queue-kebab', menuOpen && 'is-open')}
            aria-label="Действия"
            onClick={(event) => {
              event.stopPropagation();
              onMenu?.();
            }}
          >
            <MoreHorizontal size={18} />
          </button>
        ) : null}
      </div>
      <p>{item.card.contentPreview || 'Без текста'}</p>
      <div className="queue-card-footer">
        <span>{item.card.contentType}</span>
        <span>Повторы {item.card.repetition || 0}</span>
      </div>
    </Card>
  );
}

function CardsScreen(props: {
  cards: CardRecord[];
  allCards: CardRecord[];
  loading: boolean;
  error: string | null;
  query: string;
  setQuery: (value: string) => void;
  statusFilter: CardStatus | 'all';
  setStatusFilter: (value: CardStatus | 'all') => void;
  sortMode: SortMode;
  setSortMode: (value: SortMode) => void;
  reload: () => void;
  reset: () => void;
  onOpen: (card: CardRecord) => void;
  onArchive: (card: CardRecord) => void;
  onReminder: (card: CardRecord) => void;
  busyKey: string | null;
}) {
  const summary = buildSummary(props.cards);
  return (
    <>
      <Card className="toolbar-card">
        <div className="toolbar-grid">
          <Select value={props.statusFilter} onValueChange={(value) => props.setStatusFilter(value as CardStatus | 'all')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="pending">Ожидают</SelectItem>
              <SelectItem value="learning">Изучаются</SelectItem>
              <SelectItem value="awaiting_grade">Ждут оценки</SelectItem>
              <SelectItem value="archived">Архив</SelectItem>
            </SelectContent>
          </Select>
          <Select value={props.sortMode} onValueChange={(value) => props.setSortMode(value as SortMode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nextReviewAsc">Ближайший повтор</SelectItem>
              <SelectItem value="nextReviewDesc">Поздний повтор</SelectItem>
              <SelectItem value="updatedDesc">Новые сначала</SelectItem>
              <SelectItem value="repetitionDesc">Больше повторов</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="search-row">
          <Search size={16} />
          <Input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="Поиск по карточкам" />
        </div>
        <div className="toolbar-actions">
          <Button variant="outline" size="sm" onClick={props.reload}>Обновить</Button>
          <Button variant="ghost" size="sm" onClick={props.reset}>Сбросить</Button>
        </div>
        <div className="summary-row">
          <Badge tone="muted">Всего {summary.total}</Badge>
          <Badge tone="muted">Сегодня {summary.today}</Badge>
          <Badge tone="muted">Просрочены {summary.overdue}</Badge>
          <Badge tone="muted">Оценка {summary.awaiting}</Badge>
        </div>
      </Card>

      {props.loading ? <StateBlock title="Загрузка карточек" body="Получаем актуальный список." /> : null}
      {props.error ? <StateBlock title="Не удалось загрузить" body={props.error} /> : null}
      {!props.loading && !props.error && props.cards.length === 0 ? <StateBlock title="Карточек не найдено" body="Измените фильтр или добавьте новую карточку в боте." /> : null}

      <div className="cards-stack">
        {props.cards.map((card) => (
          <CardListItem key={card.id} card={card} onOpen={props.onOpen} onArchive={props.onArchive} onReminder={props.onReminder} busyKey={props.busyKey} />
        ))}
      </div>
    </>
  );
}

function CardListItem({ card, onOpen, onArchive, onReminder, busyKey }: { card: CardRecord; onOpen: (card: CardRecord) => void; onArchive: (card: CardRecord) => void; onReminder: (card: CardRecord) => void; busyKey: string | null }) {
  const canRemind = card.status === 'learning' || card.status === 'awaiting_grade';
  return (
    <Card className="card-row" role="button" tabIndex={0} onClick={() => onOpen(card)} onKeyDown={(event) => event.key === 'Enter' && onOpen(card)}>
      <div className="card-row-top">
        <Badge tone={statusTone[card.status]}>{statusLabel[card.status]}</Badge>
        <span className="meta-text">{formatDateShort(card.nextReviewAt)}</span>
      </div>
      <p className="card-row-text">{card.contentPreview || 'Без текста'}</p>
      <div className="card-row-bottom">
        <span className="meta-text">Повторы: {card.repetition || 0}</span>
        <div className="row-actions" onClick={(event) => event.stopPropagation()}>
          {canRemind ? <Button size="sm" variant="outline" disabled={busyKey === `reminder:${card.id}`} onClick={() => onReminder(card)}>Напомнить</Button> : null}
          <Button size="sm" variant="ghost" disabled={busyKey === `status:${card.id}`} onClick={() => onArchive(card)}>{card.status === 'archived' ? 'Вернуть' : 'Архив'}</Button>
        </div>
      </div>
    </Card>
  );
}

function CardDetail({
  card,
  onBack,
  onReminder,
  onOneTimeReminder,
  onArchive,
  busyKey,
}: {
  card: CardRecord;
  onBack: () => void;
  onReminder: (card: CardRecord) => void;
  onOneTimeReminder: (card: CardRecord, remindAt: string) => Promise<void>;
  onArchive: (card: CardRecord) => void;
  busyKey: string | null;
}) {
  const messageLink = getMessageLink(card);
  const canRemind = card.status !== 'archived' && card.status !== 'pending';
  const [oneTimeValue, setOneTimeValue] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 60 * 60_000)));
  const [showOneTimePanel, setShowOneTimePanel] = useState(false);
  const setOneTimePreset = (mode: 'hour' | 'evening' | 'morning') => {
    const date = new Date();
    if (mode === 'hour') {
      date.setTime(Date.now() + 60 * 60_000);
    }
    if (mode === 'evening') {
      date.setHours(20, 0, 0, 0);
      if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
    }
    if (mode === 'morning') {
      date.setDate(date.getDate() + 1);
      date.setHours(10, 0, 0, 0);
    }
    setOneTimeValue(toDatetimeLocalValue(date));
  };
  const submitOneTimeReminder = () => {
    const remindAt = parseDatetimeLocalValue(oneTimeValue);
    if (!remindAt) {
      showAlert('Выберите будущую дату и время');
      return;
    }
    void onOneTimeReminder(card, remindAt)
      .then(() => setShowOneTimePanel(false))
      .catch((error) =>
        showAlert(error instanceof Error ? error.message : 'Не удалось назначить напоминание'),
      );
  };
  return (
    <div className="detail-stack">
      <Button variant="outline" size="sm" className="back-button" onClick={onBack}><ChevronLeft size={16} />Назад</Button>
      <section className="detail-header">
        <Badge tone={statusTone[card.status]}>{statusLabel[card.status]}</Badge>
        <span className="meta-text">След. повтор: {formatDateTime(card.nextReviewAt)}</span>
      </section>
      <Card className="id-panel">
        <div>
          <span className="label-text">ID карточки</span>
          <p>{card.id}</p>
        </div>
        <Button variant="outline" size="icon" aria-label="Скопировать ID" onClick={() => void copyAndNotify(card.id, 'ID скопирован')}><Copy size={18} /></Button>
      </Card>
      <Card className="preview-panel">
        <div className="preview-icon"><Link2 size={18} /></div>
        <p>{card.contentPreview || 'Без текста'}</p>
        {card.contentType !== 'text' ? <span className="meta-text">Медиа будет загружено в Telegram.</span> : null}
      </Card>
      <div className="detail-actions">
        <Button disabled={!canRemind || busyKey === `reminder:${card.id}`} onClick={() => onReminder(card)}><Bell size={16} />Напомнить сейчас</Button>
        <Button variant="outline" disabled={!canRemind} onClick={() => setShowOneTimePanel((value) => !value)}><CalendarDays size={16} />Напомнить один раз</Button>
        <Button variant="outline" disabled={!messageLink} onClick={() => messageLink && copyAndNotify(messageLink, 'Ссылка скопирована')}><Clipboard size={16} />Скопировать ссылку</Button>
        <Button variant="destructive" disabled={busyKey === `status:${card.id}`} onClick={() => onArchive(card)}><Archive size={16} />{card.status === 'archived' ? 'Разархивировать' : 'Архивировать'}</Button>
      </div>
      {showOneTimePanel ? (
        <Card className="one-time-panel">
          <div>
            <span className="label-text">Одноразовое напоминание</span>
            <p className="meta-text">Не меняет интервальное расписание карточки.</p>
          </div>
          <div className="one-time-presets">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOneTimePreset('hour')}>Через час</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOneTimePreset('evening')}>Вечером</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOneTimePreset('morning')}>Завтра утром</Button>
          </div>
          <Input type="datetime-local" value={oneTimeValue} onChange={(event) => setOneTimeValue(event.target.value)} disabled={!canRemind} />
          <Button variant="outline" disabled={!canRemind || busyKey === `one-time:${card.id}`} onClick={submitOneTimeReminder}>
            <CalendarDays size={16} />Назначить
          </Button>
        </Card>
      ) : null}
      <Accordion type="multiple" className="detail-accordion">
        <AccordionItem value="history">
          <AccordionTrigger><Clock3 size={16} />История</AccordionTrigger>
          <AccordionContent><History card={card} /></AccordionContent>
        </AccordionItem>
        <AccordionItem value="meta">
          <AccordionTrigger><Clipboard size={16} />Дополнительно</AccordionTrigger>
          <AccordionContent><DetailsGrid card={card} /></AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function NotificationDetail({ card, onBack }: { card: CardRecord; onBack: () => void }) {
  const rows: Array<[string, string | number]> = [
    ['Текст', 'Время повторить запись'],
    ['Отправлено', formatDateTime(card.lastNotificationAt)],
    ['Причина', card.lastNotificationReason ? notificationReasonLabel[card.lastNotificationReason] : '—'],
    ['Message ID', card.lastNotificationMessageId || '—'],
    ['Base ID', card.baseChannelMessageId || '—'],
    ['Pending ID', card.pendingChannelMessageId || '—'],
  ];
  return (
    <div className="detail-stack">
      <Button variant="outline" size="sm" className="back-button" onClick={onBack}><ChevronLeft size={16} />Назад</Button>
      <Card className="preview-panel">
        <div className="preview-icon"><Bell size={18} /></div>
        <p>Время повторить запись</p>
        <span className="meta-text">Уведомление относится к карточке ниже.</span>
      </Card>
      <Card className="id-panel">
        <div><span className="label-text">ID карточки</span><p>{card.id}</p></div>
        <Button variant="outline" size="icon" onClick={() => void copyAndNotify(card.id, 'ID скопирован')}><Copy size={18} /></Button>
      </Card>
      <Card className="details-card"><KeyValueRows rows={rows} /></Card>
      <Card className="preview-panel"><p>{card.contentPreview || 'Без текста'}</p></Card>
    </div>
  );
}

function CalendarScreen({ cards, month, setMonth, selectedDate, setSelectedDate, onOpen }: { cards: CardRecord[]; month: Date; setMonth: (date: Date) => void; selectedDate: string | null; setSelectedDate: (date: string | null) => void; onOpen: (card: CardRecord) => void }) {
  const byDate = groupCardsByDate(cards);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const dayKeys = Object.keys(byDate).filter((key) => key.startsWith(`${year}-${String(monthIndex + 1).padStart(2, '0')}`)).sort();
  const activeKeys = selectedDate ? [selectedDate] : dayKeys;
  return (
    <div className="calendar-stack">
      <Card className="calendar-panel">
        <div className="calendar-nav">
          <Button variant="outline" size="icon" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}>‹</Button>
          <h2>{month.toLocaleDateString('ru', { month: 'long', year: 'numeric' })}</h2>
          <Button variant="outline" size="icon" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}>›</Button>
        </div>
        <CalendarGrid year={year} month={monthIndex} byDate={byDate} selectedDate={selectedDate} setSelectedDate={setSelectedDate} />
      </Card>
      {cards.length === 0 ? <StateBlock title="Нет запланированных повторений" body="Активные карточки появятся здесь после назначения даты." /> : null}
      {activeKeys.map((key) => <DaySection key={key} dateKey={key} cards={byDate[key] || []} onOpen={onOpen} />)}
    </div>
  );
}

function CalendarGrid({ year, month, byDate, selectedDate, setSelectedDate }: { year: number; month: number; byDate: Record<string, CardRecord[]>; selectedDate: string | null; setSelectedDate: (date: string | null) => void }) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7;
  const todayKey = toDateKey(new Date());
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(<div key={`empty-${i}`} className="cal-cell cal-empty" />);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const count = byDate[key]?.length || 0;
    cells.push(
      <button key={key} className={cn('cal-cell', count && 'has-cards', key === todayKey && 'today', selectedDate === key && 'selected')} onClick={() => setSelectedDate(selectedDate === key ? null : key)}>
        <span>{day}</span>
        {count ? <b>{count}</b> : null}
      </button>,
    );
  }
  return <div className="cal-grid"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span>{cells}</div>;
}

function DaySection({ dateKey, cards, onOpen }: { dateKey: string; cards: CardRecord[]; onOpen: (card: CardRecord) => void }) {
  if (!cards.length) return null;
  return (
    <Card className="day-panel">
      <div className="day-header"><h3>{new Date(`${dateKey}T00:00:00`).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}</h3><Badge tone="inverse">{cards.length}</Badge></div>
      <div className="day-list">
        {cards.sort((a, b) => safeDate(a.nextReviewAt) - safeDate(b.nextReviewAt)).map((card) => (
          <button key={card.id} className="day-card" onClick={() => onOpen(card)}><span>{formatTimeOnly(card.nextReviewAt)}</span><p>{card.contentPreview || 'Без текста'}</p></button>
        ))}
      </div>
    </Card>
  );
}

function StatsScreen({
  stats,
  loading,
  error,
  reminderSettings,
  settingsError,
  settingsSaving,
  onSaveReminderSettings,
}: {
  stats: Stats;
  loading: boolean;
  error: string | null;
  reminderSettings: ReminderSettings | null;
  settingsError: string | null;
  settingsSaving: boolean;
  onSaveReminderSettings: (settings: ReminderSettings) => Promise<void>;
}) {
  if (error) return <StateBlock title="Не удалось загрузить статистику" body={error} />;
  if (loading) return <StateBlock title="Загрузка статистики" body="Считаем текущий прогресс." />;
  return (
    <>
      <div className="stats-grid">
        <Card className="stat-card wide"><span>Всего карточек</span><strong>{stats.total}</strong><p>в аккаунте</p></Card>
        <Card className="stat-card"><span>Сегодня</span><strong>{stats.dueToday}</strong></Card>
        <Card className="stat-card"><span>Ожидают</span><strong>{stats.pending}</strong></Card>
        <Card className="stat-card"><span>Изучаются</span><strong>{stats.learning}</strong></Card>
        <Card className="stat-card"><span>Ждут оценки</span><strong>{stats.awaitingGrade}</strong></Card>
        <Card className="stat-card"><span>Архив</span><strong>{stats.archived}</strong></Card>
      </div>
      <ReminderSettingsPanel
        settings={reminderSettings}
        error={settingsError}
        saving={settingsSaving}
        onSave={onSaveReminderSettings}
      />
    </>
  );
}

function ReminderSettingsPanel({
  settings,
  error,
  saving,
  onSave,
}: {
  settings: ReminderSettings | null;
  error: string | null;
  saving: boolean;
  onSave: (settings: ReminderSettings) => Promise<void>;
}) {
  const [timezone, setTimezone] = useState(settings?.timezone ?? demoReminderSettings.timezone);
  const [start, setStart] = useState(minutesToTimeValue(settings?.activeHoursStart ?? demoReminderSettings.activeHoursStart));
  const [end, setEnd] = useState(minutesToTimeValue(settings?.activeHoursEnd ?? demoReminderSettings.activeHoursEnd));
  const [gap, setGap] = useState(String(settings?.minGapMinutes ?? demoReminderSettings.minGapMinutes));

  useEffect(() => {
    if (!settings) return;
    setTimezone(settings.timezone);
    setStart(minutesToTimeValue(settings.activeHoursStart));
    setEnd(minutesToTimeValue(settings.activeHoursEnd));
    setGap(String(settings.minGapMinutes));
  }, [settings]);

  const submit = () => {
    const activeHoursStart = timeValueToMinutes(start);
    const activeHoursEnd = timeValueToMinutes(end);
    const minGapMinutes = Number(gap);
    if (
      activeHoursStart === null ||
      activeHoursEnd === null ||
      activeHoursStart >= activeHoursEnd ||
      !Number.isInteger(minGapMinutes) ||
      minGapMinutes < 1 ||
      minGapMinutes > 360 ||
      !timezone.trim()
    ) {
      showAlert('Проверьте часы активности и интервал между напоминаниями');
      return;
    }
    void onSave({
      timezone: timezone.trim(),
      activeHoursStart,
      activeHoursEnd,
      minGapMinutes,
    }).catch((err) => {
      showAlert(err instanceof Error ? err.message : 'Не удалось сохранить настройки');
    });
  };

  return (
    <Card className="settings-panel">
      <div className="settings-heading">
        <div>
          <h2>Доставка напоминаний</h2>
          <p>Planner выбирает ближайший свободный слот внутри этих часов.</p>
        </div>
        {settings ? <Badge tone="muted">{minutesToTimeValue(settings.activeHoursStart)}-{minutesToTimeValue(settings.activeHoursEnd)}</Badge> : null}
      </div>
      {error ? <p className="settings-error">{error}</p> : null}
      <label className="settings-field">
        <span>Часовой пояс</span>
        <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Tbilisi" />
      </label>
      <div className="settings-time-grid">
        <label className="settings-field">
          <span>С</span>
          <Input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="settings-field">
          <span>До</span>
          <Input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      <label className="settings-field">
        <span>Минимум между напоминаниями, мин</span>
        <Input type="number" min={1} max={360} value={gap} onChange={(event) => setGap(event.target.value)} />
      </label>
      <Button disabled={saving} onClick={submit}>Сохранить настройки</Button>
    </Card>
  );
}

function RebalanceScreen({
  preview,
  error,
  busyKey,
  onPreview,
  onApply,
  onReset,
}: {
  preview: RebalancePreview | null;
  error: string | null;
  busyKey: string | null;
  onPreview: (options: { horizonDays: number; bucketMinutes: number }) => Promise<void>;
  onApply: () => void;
  onReset: () => void;
}) {
  const [horizonDays, setHorizonDays] = useState('7');
  const [bucketMinutes, setBucketMinutes] = useState('30');
  const loading = busyKey === 'rebalance:preview';
  const applying = busyKey === 'rebalance:apply';
  const build = () => {
    void onPreview({
      horizonDays: Number(horizonDays),
      bucketMinutes: Number(bucketMinutes),
    }).catch((err) => {
      showAlert(err instanceof Error ? err.message : 'Не удалось построить план');
    });
  };

  return (
    <div className="balance-stack">
      <Card className="balance-controls">
        <div className="settings-heading">
          <div>
            <h2>Балансировка напоминаний</h2>
            <p>Сначала строит визуальный вариант. Ничего не меняет без подтверждения.</p>
          </div>
          <BarChart3 size={20} />
        </div>
        <div className="settings-time-grid">
          <label className="settings-field">
            <span>Период</span>
            <Select value={horizonDays} onValueChange={setHorizonDays}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 дней</SelectItem>
                <SelectItem value="14">14 дней</SelectItem>
                <SelectItem value="30">30 дней</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="settings-field">
            <span>Шаг</span>
            <Select value={bucketMinutes} onValueChange={setBucketMinutes}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 минут</SelectItem>
                <SelectItem value="30">30 минут</SelectItem>
                <SelectItem value="60">1 час</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="toolbar-actions">
          <Button disabled={loading || applying} onClick={build}>Построить вариант</Button>
          {preview ? <Button variant="ghost" disabled={loading || applying} onClick={onReset}>Сбросить</Button> : null}
        </div>
      </Card>

      {!preview ? <StateBlock title="Плана пока нет" body="Постройте вариант, чтобы увидеть распределение до и после." /> : null}

      {preview ? (
        <>
          <div className="balance-summary-grid">
            <Card className="stat-card"><span>Всего</span><strong>{preview.metrics.total}</strong></Card>
            <Card className="stat-card"><span>Перенесено</span><strong>{preview.metrics.moved}</strong></Card>
            <Card className="stat-card"><span>Пик до</span><strong>{preview.metrics.maxBucketBefore}</strong></Card>
            <Card className="stat-card"><span>Пик после</span><strong>{preview.metrics.maxBucketAfter}</strong></Card>
          </div>

          <HeatmapComparison preview={preview} />

          <Card className="balance-diff-panel">
            <div className="settings-heading">
              <div>
                <h2>Изменения</h2>
                <p>
                  Средний сдвиг {preview.metrics.averageDeltaMinutes} мин, максимум {preview.metrics.maxDeltaMinutes} мин.
                </p>
              </div>
              <Badge tone="muted">{preview.metrics.conflictCountBefore} → {preview.metrics.conflictCountAfter}</Badge>
            </div>
            {preview.changes.filter((change) => change.deltaMinutes !== 0).length === 0 ? (
              <p className="meta-text">Текущее расписание уже выглядит ровно для выбранного периода.</p>
            ) : (
              <div className="balance-change-list">
                {preview.changes
                  .filter((change) => change.deltaMinutes !== 0)
                  .slice(0, 12)
                  .map((change) => (
                    <div className="balance-change-row" key={change.jobId}>
                      <p>{change.contentPreview || 'Без текста'}</p>
                      <span>{formatDateShort(change.beforeScheduledAt)} → {formatDateShort(change.afterScheduledAt)}</span>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          <div className="balance-actions">
            <Button
              disabled={applying || preview.metrics.moved === 0}
              onClick={onApply}
            >
              Применить
            </Button>
            <Button variant="outline" disabled={applying} onClick={onReset}>Отклонить</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function HeatmapComparison({ preview }: { preview: RebalancePreview }) {
  const maxCount = Math.max(preview.metrics.maxBucketBefore, preview.metrics.maxBucketAfter, 1);
  return (
    <div className="heatmap-comparison">
      <Heatmap title="До" heatmap={preview.heatmap} matrix={preview.heatmap.before} maxCount={maxCount} />
      <Heatmap title="После" heatmap={preview.heatmap} matrix={preview.heatmap.after} maxCount={maxCount} />
    </div>
  );
}

function Heatmap({
  title,
  heatmap,
  matrix,
  maxCount,
}: {
  title: string;
  heatmap: RebalancePreview['heatmap'];
  matrix: number[][];
  maxCount: number;
}) {
  return (
    <Card className="heatmap-panel">
      <div className="heatmap-title">
        <h2>{title}</h2>
        <Badge tone="muted">max {maxMatrix(matrix)}</Badge>
      </div>
      <div
        className="heatmap-grid"
        style={{
          gridTemplateColumns: `44px repeat(${heatmap.days.length}, minmax(24px, 1fr))`,
        }}
      >
        <span />
        {heatmap.dayLabels.map((label) => <b key={label}>{label}</b>)}
        {heatmap.slots.map((slot, rowIndex) => (
          <Fragment key={slot}>
            <span key={`${slot}-label`}>{slot}</span>
            {heatmap.days.map((day, dayIndex) => {
              const count = matrix[rowIndex]?.[dayIndex] || 0;
              const level = count ? Math.max(0.18, count / maxCount) : 0;
              return (
                <i
                  key={`${day}-${slot}`}
                  title={`${day} ${slot}: ${count}`}
                  style={{ '--heat': String(level) } as CSSProperties}
                >
                  {count || ''}
                </i>
              );
            })}
          </Fragment>
        ))}
      </div>
    </Card>
  );
}

function maxMatrix(matrix: number[][]) {
  return matrix.reduce((max, row) => Math.max(max, ...row), 0);
}

function parseCourseStepsDraft(value: string): CourseStepDraft[] {
  return value
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const title = lines[0] ?? '';
      const body = lines.slice(1).join('\n') || title;
      return {
        kind: 'material' as CourseStepKind,
        title,
        body,
      };
    })
    .filter((step) => step.title && step.body)
    .slice(0, 100);
}

function StateBlock({ title, body }: { title: string; body: string }) {
  return <Card className="state-block"><h2>{title}</h2><p>{body}</p></Card>;
}

function History({ card }: { card: CardRecord }) {
  const rows: Array<[string, string | number]> = [
    ['Создана', formatDateTime(card.createdAt)],
    ['Напоминание', formatDateTime(card.lastNotificationAt)],
    ['Ожидание оценки', formatDateTime(card.awaitingGradeSince)],
    ['Последний повтор', formatDateTime(card.lastReviewedAt)],
  ];
  return <KeyValueRows rows={rows.filter(([, value]) => value !== '—')} />;
}

function DetailsGrid({ card }: { card: CardRecord }) {
  const rows: Array<[string, string | number]> = [
    ['Повторы', card.repetition],
    ['Статус', statusLabel[card.status]],
    ['Создана', formatDateTime(card.createdAt)],
    ['Обновлена', formatDateTime(card.updatedAt)],
    ['Чат', card.sourceChatId],
    ['Сообщение', card.sourceMessageId],
  ];
  return <KeyValueRows rows={rows} />;
}

function KeyValueRows({ rows }: { rows: Array<[string, string | number]> }) {
  return <div className="kv-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{String(value)}</b></div>)}</div>;
}

function buildSummary(cards: CardRecord[]) {
  const today = toDateKey(new Date());
  return cards.reduce((acc, card) => {
    acc.total += 1;
    if (card.status === 'awaiting_grade') acc.awaiting += 1;
    if (card.nextReviewAt) {
      const key = toDateKey(card.nextReviewAt);
      if (key === today) acc.today += 1;
      if (key < today) acc.overdue += 1;
    }
    return acc;
  }, { total: 0, today: 0, overdue: 0, awaiting: 0 });
}

function buildStats(cards: CardRecord[]): Stats {
  const summary = buildSummary(cards);
  return {
    total: cards.length,
    dueToday: summary.today,
    pending: cards.filter((card) => card.status === 'pending').length,
    learning: cards.filter((card) => card.status === 'learning').length,
    awaitingGrade: cards.filter((card) => card.status === 'awaiting_grade').length,
    archived: cards.filter((card) => card.status === 'archived').length,
  };
}

function groupCardsByDate(cards: CardRecord[]) {
  return cards.reduce<Record<string, CardRecord[]>>((acc, card) => {
    if (!card.nextReviewAt) return acc;
    const key = toDateKey(card.nextReviewAt);
    acc[key] = [...(acc[key] || []), card];
    return acc;
  }, {});
}

async function copyAndNotify(value: string, message: string) {
  const copied = await copyText(value);
  if (copied) showAlert(message);
}

async function demoResponse<T>(
  endpoint: string,
  options: RequestInit,
  cards: CardRecord[],
  setCards: React.Dispatch<React.SetStateAction<CardRecord[]>>,
  courses: CourseSummary[],
  setCourses: React.Dispatch<React.SetStateAction<CourseSummary[]>>,
) {
  const source = cards.length ? cards : demoCards;
  if (endpoint.includes('/me')) return { data: { userId: 'demo', ownerTools: true } } as T;
  if (endpoint.includes('/courses/') && endpoint.includes('/start')) {
    const courseId = endpoint.match(/\/courses\/([^/]+)\/start/)?.[1] ?? '';
    setCourses((items) =>
      (items.length ? items : demoCourses).map((course) =>
        course.id === courseId
          ? { ...course, activeEnrollmentCount: course.activeEnrollmentCount + 1, updatedAt: new Date().toISOString() }
          : course,
      ),
    );
    return { data: { completed: false } } as T;
  }
  if (endpoint.endsWith('/api/miniapp/courses') && options.method === 'POST') {
    const input = typeof options.body === 'string' ? JSON.parse(options.body) : {};
    const nextCourse: CourseSummary = {
      id: `demo-course-${Date.now()}`,
      ownerUserId: 'demo',
      title: String(input.title ?? 'Новый курс'),
      description: typeof input.description === 'string' ? input.description : null,
      status: 'active',
      stepCount: Array.isArray(input.steps) ? input.steps.length : 0,
      activeEnrollmentCount: 0,
      completedEnrollmentCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setCourses((items) => [nextCourse, ...(items.length ? items : demoCourses)]);
    return { data: { course: nextCourse, steps: input.steps ?? [] } } as T;
  }
  if (endpoint.includes('/courses')) {
    const data = courses.length ? courses : demoCourses;
    if (!courses.length) setCourses(data);
    return { data } as T;
  }
  if (endpoint.includes('/queue/cards/')) return { ok: true } as T;
  if (endpoint.includes('/queue')) {
    const items = buildDemoQueueItems(source);
    return { data: { items, count: items.length, next: items[0] ?? null } } as T;
  }
  if (endpoint.includes('/stats')) return { data: buildStats(source) } as T;
  if (endpoint.includes('/settings/reminders')) {
    if (options.method === 'POST' && typeof options.body === 'string') {
      return { data: JSON.parse(options.body) } as T;
    }
    return { data: demoReminderSettings } as T;
  }
  if (endpoint.includes('/reminders/rebalance/preview')) {
    const input = typeof options.body === 'string' ? JSON.parse(options.body) : {};
    return { data: buildDemoRebalancePreview(input.horizonDays ?? 7, input.bucketMinutes ?? 30) } as T;
  }
  if (endpoint.includes('/reminders/rebalance/apply')) return { data: { updated: 3 } } as T;
  if (endpoint.includes('/status')) return { ok: true } as T;
  if (endpoint.includes('/send-reminder')) return { ok: true } as T;
  if (endpoint.includes('/one-time-reminder')) return { ok: true } as T;
  const statusMatch = endpoint.match(/status=([^&]+)/);
  const data = statusMatch ? source.filter((card) => card.status === statusMatch[1]) : source;
  if (!cards.length) setCards(source);
  return { data } as T;
}

function buildDemoQueueItems(cards: CardRecord[]): ReminderQueueItem[] {
  return cards
    .filter((card) => card.status === 'awaiting_grade' || card.status === 'learning')
    .slice(0, 6)
    .map((card, index) => ({
      id: `demo-queue-${card.id}`,
      kind: card.status === 'awaiting_grade' ? 'awaiting_review' : 'scheduled_review',
      card,
      job: card.status === 'awaiting_grade'
        ? {
          id: `demo-job-${card.id}`,
          cardId: card.id,
          userId: card.userId ?? 'demo',
          kind: 'review',
          status: 'awaiting_action',
          dueAt: card.nextReviewAt ?? new Date().toISOString(),
          scheduledAt: card.nextReviewAt ?? new Date().toISOString(),
          sentAt: card.awaitingGradeSince,
          completedAt: null,
        }
        : null,
      availableAt: card.awaitingGradeSince ?? card.nextReviewAt ?? card.updatedAt,
      isDue: index === 0 || card.status === 'awaiting_grade',
    }));
}

function buildDemoRebalancePreview(horizonDays: number, bucketMinutes: number): RebalancePreview {
  const days = Array.from({ length: Number(horizonDays) || 7 }, (_value, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return toDateKey(date);
  });
  const dayLabels = days.map((day) => new Date(`${day}T00:00:00`).toLocaleDateString('ru', { day: 'numeric', month: 'short' }));
  const slots = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30'];
  const before = slots.map((_slot, row) => days.map((_day, col) => (col === 0 && row === 4 ? 5 : col === 1 && row === 4 ? 3 : row === 1 && col === 2 ? 2 : 0)));
  const after = slots.map((_slot, row) => days.map((_day, col) => ((row + col) % 5 === 0 ? 1 : 0)));
  const now = new Date().toISOString();
  return {
    planToken: 'demo',
    generatedAt: now,
    horizonDays: Number(horizonDays) || 7,
    bucketMinutes: Number(bucketMinutes) || 30,
    settings: demoReminderSettings,
    range: { start: now, end: now },
    metrics: {
      total: 10,
      moved: 8,
      maxBucketBefore: 5,
      maxBucketAfter: 1,
      conflictCountBefore: 5,
      conflictCountAfter: 0,
      averageDeltaMinutes: 90,
      maxDeltaMinutes: 180,
    },
    heatmap: { days, dayLabels, slots, before, after },
    changes: [
      {
        id: 'demo-1',
        jobId: 'demo-1',
        cardId: demoCards[0].id,
        contentPreview: demoCards[0].contentPreview,
        dueAt: now,
        beforeScheduledAt: now,
        afterScheduledAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        deltaMinutes: 60,
      },
    ],
  };
}
