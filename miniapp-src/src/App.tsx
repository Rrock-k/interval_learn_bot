import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clipboard,
  Clock3,
  Copy,
  Link2,
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

type CardStatus = 'pending' | 'learning' | 'awaiting_grade' | 'archived';
type ViewName = 'cards' | 'calendar' | 'stats' | 'card-detail' | 'notification-detail';
type SortMode = 'nextReviewAsc' | 'nextReviewDesc' | 'updatedDesc' | 'repetitionDesc';
type NotificationReason = 'scheduled' | 'manual_now' | 'manual_override';

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

type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { start_param?: string };
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
  const decoded = decodeURIComponent(raw);
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

function buildMessageLink(chatIdRaw?: string | null, messageIdRaw?: number | null) {
  if (!chatIdRaw || !messageIdRaw) return null;
  const chatId = String(chatIdRaw);
  const messageId = Number(messageIdRaw);
  if (!Number.isInteger(messageId) || messageId <= 0) return null;
  if (chatId.startsWith('-100')) return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  if (chatId.startsWith('-')) return null;
  return `tg://openmessage?user_id=${chatId}&message_id=${messageId}`;
}

function getMessageLink(card: CardRecord) {
  if (card.status === 'awaiting_grade') {
    const pendingLink = buildMessageLink(card.pendingChannelId, card.pendingChannelMessageId);
    if (pendingLink) return pendingLink;
  }
  return buildMessageLink(card.sourceChatId, card.sourceMessageId);
}

export function App() {
  const [view, setView] = useState<ViewName>('cards');
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
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
  const screenTitle =
    view === 'card-detail'
      ? 'Карточка'
      : view === 'notification-detail'
        ? 'Уведомление'
        : view === 'calendar'
          ? 'Календарь'
          : view === 'stats'
            ? 'Статистика'
            : 'Мои карточки';
  const screenSubtitle =
    view === 'calendar'
      ? 'Ближайшие повторения по дням.'
      : view === 'stats'
        ? 'Короткая сводка по прогрессу.'
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
      return demoResponse<T>(endpoint, options, cards, setCards);
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

  const loadStats = async () => {
    if (demo) {
      setStats(buildStats(cards.length ? cards : demoCards));
      return;
    }
    const result = await apiCall<{ data: Stats }>('/api/miniapp/stats');
    setStats(result.data);
  };

  useEffect(() => {
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
    if (deepLink.type === 'view' && ['cards', 'calendar', 'stats'].includes(deepLink.view)) {
      setView(deepLink.view);
    }
  }, [loading, cards.length]);

  useEffect(() => {
    if (view === 'stats') void loadStats();
  }, [view]);

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
          <TabsList>
            <TabsTrigger value="cards">Карточки</TabsTrigger>
            <TabsTrigger value="calendar">Календарь</TabsTrigger>
            <TabsTrigger value="stats">Статистика</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      <main className="app-main" key={view}>
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
          <CardDetail card={selectedCard} onBack={() => setView('cards')} onReminder={requestReminder} onArchive={requestArchive} busyKey={busyKey} />
        ) : null}

        {view === 'notification-detail' && selectedCard ? <NotificationDetail card={selectedCard} onBack={() => setView('cards')} /> : null}

        {view === 'calendar' ? (
          <CalendarScreen cards={scheduledCards} month={calendarMonth} setMonth={setCalendarMonth} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onOpen={openCard} />
        ) : null}

        {view === 'stats' ? <StatsScreen stats={stats || buildStats(cards)} loading={!stats} /> : null}
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

function CardDetail({ card, onBack, onReminder, onArchive, busyKey }: { card: CardRecord; onBack: () => void; onReminder: (card: CardRecord) => void; onArchive: (card: CardRecord) => void; busyKey: string | null }) {
  const messageLink = getMessageLink(card);
  const canRemind = card.status !== 'archived' && card.status !== 'pending';
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
        <Button variant="outline" disabled={!messageLink} onClick={() => messageLink && copyAndNotify(messageLink, 'Ссылка скопирована')}><Clipboard size={16} />Скопировать ссылку</Button>
        <Button variant="destructive" disabled={busyKey === `status:${card.id}`} onClick={() => onArchive(card)}><Archive size={16} />{card.status === 'archived' ? 'Разархивировать' : 'Архивировать'}</Button>
      </div>
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
  const rows = [
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

function StatsScreen({ stats, loading }: { stats: Stats; loading: boolean }) {
  if (loading) return <StateBlock title="Загрузка статистики" body="Считаем текущий прогресс." />;
  return (
    <div className="stats-grid">
      <Card className="stat-card wide"><span>Всего карточек</span><strong>{stats.total}</strong><p>в аккаунте</p></Card>
      <Card className="stat-card"><span>Сегодня</span><strong>{stats.dueToday}</strong></Card>
      <Card className="stat-card"><span>Ожидают</span><strong>{stats.pending}</strong></Card>
      <Card className="stat-card"><span>Изучаются</span><strong>{stats.learning}</strong></Card>
      <Card className="stat-card"><span>Ждут оценки</span><strong>{stats.awaitingGrade}</strong></Card>
      <Card className="stat-card"><span>Архив</span><strong>{stats.archived}</strong></Card>
    </div>
  );
}

function StateBlock({ title, body }: { title: string; body: string }) {
  return <Card className="state-block"><h2>{title}</h2><p>{body}</p></Card>;
}

function History({ card }: { card: CardRecord }) {
  const rows = [
    ['Создана', formatDateTime(card.createdAt)],
    ['Напоминание', formatDateTime(card.lastNotificationAt)],
    ['Ожидание оценки', formatDateTime(card.awaitingGradeSince)],
    ['Последний повтор', formatDateTime(card.lastReviewedAt)],
  ].filter(([, value]) => value !== '—');
  return <KeyValueRows rows={rows} />;
}

function DetailsGrid({ card }: { card: CardRecord }) {
  return <KeyValueRows rows={[
    ['Повторы', card.repetition],
    ['Статус', statusLabel[card.status]],
    ['Создана', formatDateTime(card.createdAt)],
    ['Обновлена', formatDateTime(card.updatedAt)],
    ['Чат', card.sourceChatId],
    ['Сообщение', card.sourceMessageId],
  ]} />;
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

async function demoResponse<T>(endpoint: string, options: RequestInit, cards: CardRecord[], setCards: React.Dispatch<React.SetStateAction<CardRecord[]>>) {
  const source = cards.length ? cards : demoCards;
  if (endpoint.includes('/stats')) return { data: buildStats(source) } as T;
  if (endpoint.includes('/status')) return { ok: true } as T;
  if (endpoint.includes('/send-reminder')) return { ok: true } as T;
  const statusMatch = endpoint.match(/status=([^&]+)/);
  const data = statusMatch ? source.filter((card) => card.status === statusMatch[1]) : source;
  if (!cards.length) setCards(source);
  return { data } as T;
}
