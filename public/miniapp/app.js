// Telegram WebApp initialization
const tg = window.Telegram?.WebApp || {
  initData: '',
  initDataUnsafe: {},
  themeParams: {},
  ready() {},
  expand() {},
  showAlert(message) {
    window.alert(message);
  },
};
tg.ready?.();
tg.expand?.();

const hexToRgb = (value) => {
  if (!value || typeof value !== 'string') return null;
  const hex = value.trim().replace('#', '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) return null;
  const normalized =
    hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  const number = Number.parseInt(normalized, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
};

const isDarkColor = (value) => {
  const rgb = hexToRgb(value);
  if (!rgb) return false;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255 < 0.45;
};

// Apply Telegram theme
const applyTheme = () => {
  const params = tg.themeParams || {};
  const set = (name, paramName, fallback) =>
    document.documentElement.style.setProperty(name, params[paramName] || fallback);

  set('--tg-theme-bg-color', 'bg_color', '#ffffff');
  set('--tg-theme-text-color', 'text_color', '#0f172a');
  set('--tg-theme-hint-color', 'hint_color', '#64748b');
  set('--tg-theme-link-color', 'link_color', '#2563eb');
  set('--tg-theme-button-color', 'button_color', '#2563eb');
  set('--tg-theme-button-text-color', 'button_text_color', '#ffffff');
  set('--tg-theme-secondary-bg-color', 'secondary_bg_color', '#f8fafc');

  const bg = document.documentElement.style.getPropertyValue('--tg-theme-bg-color');
  const text = document.documentElement.style.getPropertyValue('--tg-theme-text-color');
  const hint = document.documentElement.style.getPropertyValue('--tg-theme-hint-color');
  const resolvedBg = bg || '#ffffff';
  const resolvedText = text || '#0f172a';
  const resolvedHint = hint || '#64748b';
  const isDark = isDarkColor(resolvedBg);
  const themeTokens = isDark
    ? {
        '--surface': '#0b1120',
        '--secondary': '#111827',
        '--muted': '#1f2937',
        '--accent': '#172554',
        '--accent-foreground': '#bfdbfe',
        '--border': '#334155',
        '--ring': '#60a5fa',
        '--text-soft': resolvedHint || '#cbd5e1',
        '--text-subtle': '#94a3b8',
        '--destructive': '#ef4444',
        '--shadow-soft': 'none',
      }
    : {
        '--surface': '#f8fafc',
        '--secondary': '#f8fafc',
        '--muted': '#f3f4f6',
        '--accent': '#eef2ff',
        '--accent-foreground': '#1d4ed8',
        '--border': '#e5e7eb',
        '--ring': '#93c5fd',
        '--text-soft': resolvedHint || '#6b7280',
        '--text-subtle': '#9ca3af',
        '--destructive': '#dc2626',
        '--shadow-soft': '0 8px 24px rgba(15, 23, 42, 0.06)',
      };

  document.documentElement.style.setProperty('--background', resolvedBg);
  document.documentElement.style.setProperty('--foreground', resolvedText);
  document.documentElement.style.setProperty('--muted-foreground', resolvedHint);
  document.documentElement.style.setProperty('--card', resolvedBg);
  document.documentElement.style.setProperty('--popover', resolvedBg);
  document.documentElement.style.setProperty('--card-foreground', resolvedText);
  document.documentElement.style.setProperty('--popover-foreground', resolvedText);
  Object.entries(themeTokens).forEach(([name, value]) => {
    document.documentElement.style.setProperty(name, value);
  });
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
};

applyTheme();
if (typeof tg.onEvent === 'function') {
  tg.onEvent('themeChanged', applyTheme);
}

// State
const CARD_RENDER_BATCH_SIZE = 40;
let currentView = 'cards';
let cardsData = [];
let currentFilter = '';
let currentSortMode = 'nextReviewAsc';
let currentSearchQuery = '';
let currentCardId = null;
let cardsLoaded = false;
let visibleCardsLimit = CARD_RENDER_BATCH_SIZE;
let searchDebounceTimer = null;
const actionLocks = new Set();

const cardsSummary = document.getElementById('cardsSummary');
const cardsHintElement = document.getElementById('cardsHint');
const cardsListElement = document.getElementById('cardsList');
const statusFilterElement = document.getElementById('statusFilter');
const cardsSearchInputElement = document.getElementById('cardsSearch');
const cardsSortElement = document.getElementById('cardsSort');
const cardsRefreshButton = document.getElementById('cardsRefreshBtn');
const cardsClearFiltersButton = document.getElementById('cardsClearFiltersBtn');
const viewTabsElement = document.querySelector('.view-tabs');

const getStartParamRaw = () => {
  const fromInitData = tg?.initDataUnsafe?.start_param;
  if (fromInitData) return fromInitData;

  const searchParams = new URLSearchParams(window.location.search);
  const fromSearch =
    searchParams.get('tgWebAppStartParam') ||
    searchParams.get('startapp') ||
    searchParams.get('start_param');
  if (fromSearch) return fromSearch;

  if (window.location.hash) {
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const queryIndex = hash.indexOf('?');
    if (queryIndex !== -1) {
      const hashQuery = hash.slice(queryIndex + 1);
      const hashParams = new URLSearchParams(hashQuery);
      const fromHash =
        hashParams.get('tgWebAppStartParam') ||
        hashParams.get('startapp') ||
        hashParams.get('start_param');
      if (fromHash) return fromHash;
    }
  }

  return null;
};

const parseStartParam = () => {
  const raw = getStartParamRaw();
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    console.warn('Failed to decode start param', error);
  }

  if (decoded.startsWith('card_')) {
    const cardId = decoded.slice('card_'.length);
    if (cardId) {
      return { type: 'card', cardId };
    }
  }

  if (decoded.startsWith('notification_')) {
    const cardId = decoded.slice('notification_'.length);
    if (cardId) {
      return { type: 'notification', cardId };
    }
  }

  if (decoded.startsWith('view_')) {
    const view = decoded.slice('view_'.length);
    if (['cards', 'calendar', 'stats'].includes(view)) {
      return { type: 'view', view };
    }
  }

  return null;
};

const initialDeepLink = parseStartParam();
let deepLinkHandled = false;

const cardDetailContent = document.getElementById('cardDetailContent');
const cardBackBtn = document.getElementById('cardBackBtn');
const notificationDetailContent = document.getElementById('notificationDetailContent');
const notificationBackBtn = document.getElementById('notificationBackBtn');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmTitle = document.getElementById('confirmTitle');
const confirmBody = document.getElementById('confirmBody');
const confirmCancel = document.getElementById('confirmCancel');
const confirmConfirm = document.getElementById('confirmConfirm');

const statusEmoji = {
  pending: '⏳',
  learning: '📖',
  awaiting_grade: '⏱️',
  archived: '📦',
};

const statusName = {
  pending: 'Ожидает',
  learning: 'Изучается',
  awaiting_grade: 'Ждёт оценки',
  archived: 'Архив',
};

const statusChipClass = {
  pending: 'status-chip--pending',
  learning: 'status-chip--learning',
  awaiting_grade: 'status-chip--awaiting_grade',
  archived: 'status-chip--archived',
};

const notificationReasonLabel = {
  scheduled: 'по расписанию',
  manual_now: 'вручную',
  manual_override: 'дата вручную',
};

const copyIconSvg = `
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
`;

const renderCardsSummary = (cards) => {
  if (!cardsSummary) return;
  const total = cards.length;
  let dueToday = 0;
  let overdue = 0;
  let awaitingGrade = 0;

  const today = toDateKey(new Date());

  cards.forEach((card) => {
    if (card.status === 'awaiting_grade') {
      awaitingGrade += 1;
    }
    if (!card.nextReviewAt) {
      return;
    }

    const reviewKey = toDateKey(card.nextReviewAt);
    if (reviewKey < today) {
      overdue += 1;
    }
    if (reviewKey === today) {
      dueToday += 1;
    }
  });

  cardsSummary.innerHTML = `
    <span class="summary-chip">Всего: ${total}</span>
    <span class="summary-chip">Сегодня: ${dueToday}</span>
    <span class="summary-chip">Просрочены: ${overdue}</span>
    <span class="summary-chip">Ожидают оценки: ${awaitingGrade}</span>
  `;
};

const updateCardsHint = (cardsCount, hasFilters) => {
  if (!cardsHintElement) return;

  let hintText = 'Подсказка: тапните карточку для подробностей и действий.';
  if (hasFilters) {
    hintText =
      'Подсказка: включены фильтр или поиск. Сбросьте фильтры, чтобы увидеть все карточки.';
  }
  if (cardsCount === 0) {
    hintText =
      'Подсказка: карточек не найдено. Проверьте фильтры или обновите список.';
  }
  cardsHintElement.innerHTML = `<div class="toolbar__helper-chip">${escapeHtml(hintText)}</div>`;
};

const getSortedCards = (cards) => {
  const copy = [...cards];
  const safeDateValue = (iso) => {
    const ms = iso ? new Date(iso).getTime() : Number.NaN;
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
  };

  if (currentSortMode === 'nextReviewDesc') {
    copy.sort(
      (a, b) => safeDateValue(b.nextReviewAt) - safeDateValue(a.nextReviewAt),
    );
  } else if (currentSortMode === 'updatedDesc') {
    copy.sort((a, b) => safeDateValue(b.updatedAt) - safeDateValue(a.updatedAt));
  } else if (currentSortMode === 'repetitionDesc') {
    copy.sort((a, b) => Number(b.repetition || 0) - Number(a.repetition || 0));
  } else {
    copy.sort((a, b) => safeDateValue(a.nextReviewAt) - safeDateValue(b.nextReviewAt));
  }

  return copy;
};

const getFilteredCards = (cards) => {
  const query = currentSearchQuery.trim().toLowerCase();
  if (!query) return getSortedCards(cards);

  return getSortedCards(
    cards.filter((card) => (card.contentPreview || '').toLowerCase().includes(query)),
  );
};

async function apiCall(endpoint, options = {}) {
  if (!tg.initData) {
    throw new Error('Telegram initData не доступен. Откройте приложение через бота.');
  }

  const url = `${window.location.origin}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg.initData,
  };

  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText}`);
  }

  return response.json();
}

const parseApiError = (error) => {
  if (!error) return { status: 0, message: 'Неизвестная ошибка' };
  if (error instanceof Error) {
    const match = /API Error (\d+): (.*)/.exec(error.message);
    if (match) {
      const status = Number(match[1]);
      const rawMessage = match[2] || error.message;
      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
          return { status, message: parsed.error };
        }
      } catch {
        // ignore
      }
      return { status, message: rawMessage };
    }
  }
  return { status: 0, message: `${error}` };
};

const getErrorMessage = (error) => {
  const parsed = parseApiError(error);
  return parsed.message || 'Неизвестная ошибка';
};

const setBusyButtonState = (button, isBusy, pendingText = 'Подождите…') => {
  if (!button || button.tagName !== 'BUTTON') return;
  if (isBusy) {
    if (!button.dataset.busy) {
      button.dataset.busy = '0';
      button.dataset.originalText = button.textContent || '';
    }
    button.classList.add('button--loading');
    button.dataset.busy = '1';
    button.disabled = true;
    button.textContent = pendingText;
    button.setAttribute('aria-busy', 'true');
    return;
  }

  button.classList.remove('button--loading');
  button.disabled = false;
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
  button.removeAttribute('aria-busy');
  button.dataset.busy = '0';
};

const runButtonAction = async ({ cardId, action, button, pendingText }, callback) => {
  const key = `${String(cardId)}:${action}`;
  if (actionLocks.has(key)) {
    return false;
  }
  actionLocks.add(key);
  setBusyButtonState(button, true, pendingText);
  try {
    return await callback();
  } finally {
    actionLocks.delete(key);
    setBusyButtonState(button, false);
  }
};

// View switching
function switchView(viewName) {
  currentView = viewName;
  const isDetailView = viewName === 'card-detail' || viewName === 'notification-detail';
  const activeTabView = isDetailView ? 'cards' : viewName;
  if (!isDetailView) {
    currentCardId = null;
  }

  if (viewTabsElement) {
    viewTabsElement.classList.toggle('is-hidden', isDetailView);
  }
  
  // Update tabs
  document.querySelectorAll('.tab').forEach(tab => {
    const isActive = tab.dataset.view === activeTabView;
    tab.classList.toggle('tab--active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  
  // Update views
  document.querySelectorAll('.view').forEach(view => {
    const isActive = view.dataset.view === viewName;
    view.classList.toggle('view--active', isActive);
  });
  
  // Load view content
  if (viewName === 'cards' && !cardsLoaded) {
    void loadCards();
  } else if (viewName === 'calendar') {
    // Reset calendar to current month when switching to calendar view
    calendarMonth = new Date();
    calendarSelectedDate = null;
    void loadCalendar();
  } else if (viewName === 'stats') {
    void loadStats();
  }
}

const loadCardById = async (cardId) => {
  const existingCard = cardsData.find((card) => card.id === cardId);
  if (existingCard) return existingCard;

  const result = await apiCall(`/api/miniapp/cards/${cardId}`);
  const card = result.data;
  if (card && !cardsData.some((item) => item.id === card.id)) {
    cardsData = [card, ...cardsData];
  }
  return card;
};

const handleDeepLinkAfterCardsLoad = async () => {
  if (deepLinkHandled || !initialDeepLink) return false;
  if (initialDeepLink.type !== 'card') return false;

  try {
    const targetCard = await loadCardById(initialDeepLink.cardId);
    if (!targetCard) {
      tg.showAlert('Карточка не найдена. Возможно, она удалена или доступ ограничен.');
      deepLinkHandled = true;
      return true;
    }

    currentCardId = targetCard.id;
    renderCardDetail(targetCard);
    switchView('card-detail');
    deepLinkHandled = true;
    return true;
  } catch (error) {
    console.error('Failed to open deep link card', error);
    tg.showAlert('Карточка не найдена. Возможно, она удалена или доступ ограничен.');
    deepLinkHandled = true;
    return true;
  }
};

// Cards view
const renderVisibleCards = () => {
  const visibleCards = getFilteredCards(cardsData);
  const renderedCards = visibleCards.slice(0, visibleCardsLimit);
  const hasMoreCards = visibleCards.length > renderedCards.length;
  const hasFilters = Boolean(currentFilter || currentSearchQuery.trim());

  renderCardsSummary(visibleCards);
  updateCardsHint(visibleCards.length, hasFilters);

  if (visibleCards.length === 0) {
    const hasActiveFilter = currentSearchQuery.trim() || currentFilter;
    const hasTitle = hasActiveFilter ? 'Ничего не найдено' : 'Карточек пока нет';
    const hasMessage = hasActiveFilter
      ? 'Измените фильтр или текст поиска, чтобы увидеть карточки.'
      : 'Добавьте напоминания в боте, и они появятся здесь автоматически.';

    cardsListElement.innerHTML = `
      <div class="empty">
        <div class="empty__icon">📚</div>
        <div class="empty__text">${hasTitle}</div>
        <div class="empty__subtext">${hasMessage}</div>
      </div>
    `;
    return;
  }

  cardsListElement.innerHTML = `
    ${renderedCards.map((card) => renderCard(card)).join('')}
    ${
      hasMoreCards
        ? `<button class="button button--outline cards-list__more" type="button" data-action="show-more-cards">
            Показать ещё ${Math.min(CARD_RENDER_BATCH_SIZE, visibleCards.length - renderedCards.length)}
          </button>`
        : ''
    }
  `;
  attachSwipeListeners();
};

async function loadCards() {
  if (!cardsListElement) return;
  cardsListElement.innerHTML = '<div class="loading">Загрузка...</div>';
  
  try {
    const params = currentFilter ? `?status=${currentFilter}` : '';
    const result = await apiCall(`/api/miniapp/cards${params}`);
    cardsData = result.data || [];
    cardsLoaded = true;
    visibleCardsLimit = CARD_RENDER_BATCH_SIZE;

    const deepLinkWasHandled = await handleDeepLinkAfterCardsLoad();
    if (!deepLinkWasHandled) {
      renderVisibleCards();
    }
  } catch (error) {
    console.error('Error loading cards:', error);
    renderCardsSummary([]);
    updateCardsHint(0, false);
    const safeMessage = getErrorMessage(error);
    cardsListElement.innerHTML = `
      <div class="empty">
        <div class="empty__icon">⚠️</div>
        <div class="empty__text">Не удалось загрузить карточки</div>
        <div class="empty__subtext">${escapeHtml(safeMessage)}</div>
      </div>
    `;
  }
}

function renderCard(card) {
  const nextReview = formatDateTimeShort(card.nextReviewAt);
  const isArchived = card.status === 'archived';
  const swipeLabel = isArchived ? '↩️ Вернуть' : '📦 Архив';
  const repetitionValue = Number.isFinite(card.repetition) ? card.repetition : 0;
  const status = statusChipClass[card.status] || 'status-chip--pending';
  const hasDate = Boolean(card.nextReviewAt);
  const actionLabel = isArchived ? '↩️ Вернуть' : '📦 Архив';
  const canSendReminder = card.status === 'learning' || card.status === 'awaiting_grade';
  const statusLabel = statusName[card.status] || 'Неизвестный статус';
  const statusIcon = statusEmoji[card.status] || '📄';
  const contentText = card.contentPreview || 'Без текста';

  return `
    <div class="card-swipe-container" data-card-id="${card.id}" data-archived="${isArchived}">
      <div class="card-swipe-background">
        <div class="card-swipe-background__content"> ${swipeLabel}</div>
      </div>
      <div class="card" data-card-id="${card.id}" role="button" tabindex="0">
        <div class="card__header">
          <span class="status-chip ${status}">
            ${statusIcon} ${statusLabel}
          </span>
          <span class="card__date">${hasDate ? `След. повторение: ${nextReview}` : 'Без даты'}</span>
        </div>
        <div class="card__content">${escapeHtml(contentText)}</div>
        <div class="card__meta">
          <span class="card__meta-item">🔁 ${repetitionValue}</span>
        </div>
        <div class="card__actions">
          ${
            canSendReminder
              ? `<button
            class="button button--outline button--sm"
            type="button"
            data-action="send-reminder-inline"
            data-card-id="${card.id}"
          >
            🔔 Напомнить сейчас
          </button>`
              : ''
          }
          <button
            class="button button--outline button--sm"
            type="button"
            data-action="toggle-archive-inline"
            data-card-id="${card.id}"
          >
            ${actionLabel}
          </button>
        </div>
      </div>
    </div>
  `;
}

const formatDateTime = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('ru', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDateTimeShort = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('ru', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatTimeOnly = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
};

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return String(value);
};

const miniAppBuildMessageLink =
  (window && window.buildMessageLink) ||
  ((chatIdRaw, messageIdRaw) => {
    if (!chatIdRaw || !messageIdRaw) return null;

    const chatId = String(chatIdRaw);
    const messageId = Number(messageIdRaw);
    if (!Number.isInteger(messageId) || messageId <= 0) return null;

    if (chatId.startsWith('-100')) {
      return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
    }

    if (chatId.startsWith('-')) {
      return null;
    }

    return `tg://openmessage?user_id=${chatId}&message_id=${messageId}`;
  });

const miniAppGetMessageLink =
  (window && window.getMessageLink) ||
  ((card) => {
    if (!card) return null;
    if (card?.status === 'awaiting_grade') {
      const pendingLink = miniAppBuildMessageLink(card.pendingChannelId, card.pendingChannelMessageId);
      if (pendingLink) {
        return pendingLink;
      }
    }

    return miniAppBuildMessageLink(card.sourceChatId, card.sourceMessageId);
  });

const openTelegramLink = (url) => {
  if (!url) return;
  if (typeof tg.openTelegramLink === 'function') {
    tg.openTelegramLink(url);
    return;
  }
  window.location.href = url;
};

const copyToClipboard = async (value) => {
  const text = value == null ? '' : String(value);
  if (!text.trim()) {
    return false;
  }
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    }

    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Copy error', error);
    return false;
  }
};

const showConfirmDialog = ({ title, body, confirmLabel, cancelLabel, confirmTone = 'primary' }) =>
  new Promise((resolve) => {
    if (!confirmOverlay || !confirmTitle || !confirmBody || !confirmConfirm || !confirmCancel) {
      resolve(false);
      return;
    }

    confirmTitle.textContent = title;
    confirmBody.textContent = body;
    confirmConfirm.textContent = confirmLabel || 'Подтвердить';
    confirmCancel.textContent = cancelLabel || 'Отмена';
    confirmCancel.className =
      'button button--outline button--sm';
    confirmConfirm.className =
      `button button--sm ${confirmTone === 'danger'
        ? 'button--destructive'
        : 'button--default'}`;

    confirmOverlay.classList.remove('is-hidden');
    confirmOverlay.setAttribute('aria-hidden', 'false');

    const cleanup = (result) => {
      confirmOverlay.classList.add('is-hidden');
      confirmOverlay.setAttribute('aria-hidden', 'true');
      confirmOverlay.removeEventListener('click', handleOverlayClick);
      confirmCancel.removeEventListener('click', handleCancel);
      confirmConfirm.removeEventListener('click', handleConfirm);
      resolve(result);
    };

    const handleCancel = () => cleanup(false);
    const handleConfirm = () => cleanup(true);
    const handleOverlayClick = (event) => {
      if (event.target === confirmOverlay) {
        cleanup(false);
      }
    };

    confirmCancel.addEventListener('click', handleCancel);
    confirmConfirm.addEventListener('click', handleConfirm);
    confirmOverlay.addEventListener('click', handleOverlayClick);
  });

const updateCardStatus = async (cardId, status) => {
  await apiCall(`/api/miniapp/cards/${cardId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });

  const updatedAt = new Date().toISOString();
  cardsData = cardsData.map((card) =>
    card.id === cardId ? { ...card, status, updatedAt } : card,
  );
};

const confirmArchiveChange = async (isArchived) => {
  const confirm = await showConfirmDialog({
    title: isArchived ? 'Разархивировать карточку?' : 'Архивировать карточку?',
    body: isArchived
      ? 'Карточка вернётся в активные.'
      : 'Карточка исчезнет из активных списков.',
    confirmLabel: isArchived ? 'Разархивировать' : 'Архивировать',
    cancelLabel: 'Отмена',
    confirmTone: isArchived ? 'primary' : 'danger',
  });

  if (!confirm) {
    return false;
  }

  return true;
};

const buildHistoryItems = (card) => {
  const items = [];

  if (card.createdAt) {
    items.push({ title: 'Создана', date: card.createdAt });
  }

  if (card.lastNotificationAt) {
    const reason = notificationReasonLabel[card.lastNotificationReason] || null;
    items.push({
      title: 'Напоминание отправлено',
      date: card.lastNotificationAt,
      detail: reason ? `(${reason})` : null,
    });
  }

  if (card.awaitingGradeSince) {
    items.push({ title: 'Ожидание оценки', date: card.awaitingGradeSince });
  }

  if (card.lastReviewedAt) {
    items.push({ title: 'Повтор', date: card.lastReviewedAt });
  }

  if (card.status === 'archived' && card.updatedAt) {
    items.push({ title: 'Архивирована', date: card.updatedAt });
  }

  return items
    .filter((item) => item.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
};

const renderHistory = (card) => {
  const items = buildHistoryItems(card);
  if (!items.length) {
    return '<div class="history-empty">Пока нет событий.</div>';
  }
  return `
    <ul class="history-list">
      ${items
        .map(
          (item) => `
        <li>
          <div class="history-item__title">${escapeHtml(item.title)}</div>
          <div class="history-item__meta">
            ${escapeHtml(formatDateTime(item.date))}${item.detail ? ` • ${escapeHtml(item.detail)}` : ''}
          </div>
        </li>
      `,
        )
        .join('')}
    </ul>
  `;
};

const renderPreview = (card) => {
  const previewText = escapeHtml(card.contentPreview || 'Без текста');
  if (card.contentType === 'photo' && card.contentFileId) {
    return `
      <img src="/api/miniapp/cards/${card.id}/media" alt="Фото" class="card-detail__media media-preview" loading="lazy" />
      <div class="card-detail__preview-text">${previewText}</div>
    `;
  }
  if (card.contentType === 'video' && card.contentFileId) {
    return `
      <video src="/api/miniapp/cards/${card.id}/media" class="card-detail__media media-preview" controls preload="metadata"></video>
      <div class="card-detail__preview-text">${previewText}</div>
    `;
  }
  return `<div class="card-detail__preview-text">${previewText}</div>`;
};

const renderAdditionalDetails = (card) => {
  const detailRows = [
    ['След. повторение', formatDateTime(card.nextReviewAt)],
    ['Повторы', formatValue(card.repetition)],
    ['Последний повтор', formatDateTime(card.lastReviewedAt)],
    ['Создана', formatDateTime(card.createdAt)],
    ['Обновлена', formatDateTime(card.updatedAt)],
    ['Чат', formatValue(card.sourceChatId)],
    ['Сообщение', formatValue(card.sourceMessageId)],
  ];

  return `
    <div class="detail-grid">
      ${detailRows
        .map(
          ([label, value]) => `
        <div class="detail-row">
          <span class="detail-label">${escapeHtml(label)}</span>
          <span class="detail-value">${escapeHtml(String(value))}</span>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
};

const renderCardDetail = (card) => {
  if (!cardDetailContent) return;
  const statusText = `${statusEmoji[card.status] ?? ''} ${statusName[card.status] ?? card.status}`.trim();
  const nextReview = formatDateTime(card.nextReviewAt);
  const isArchived = card.status === 'archived';
  const statusClass = statusChipClass[card.status] || 'status-chip--learning';
  const actionLabel = isArchived ? 'Разархивировать' : 'Архивировать';
  const actionTone = isArchived
    ? 'button button--outline'
    : 'button button--destructive';
  const canSendReminder = !isArchived && card.status !== 'pending';
  const hasMessageLink = Boolean(getMessageLink(card));
  const reminderButtonTone = canSendReminder
    ? 'button button--default'
    : 'button button--outline button--ghost';

  cardDetailContent.innerHTML = `
    <div class="card-detail__header">
      <span class="status-chip ${statusClass}">${escapeHtml(statusText)}</span>
      <span class="card-detail__next">След. повтор: ${escapeHtml(nextReview)}</span>
    </div>
    <div class="card-detail__id-row">
      <div class="card-detail__id-meta">
        <span class="card-detail__id-label">ID карточки</span>
        <span class="card-detail__id-value">${escapeHtml(card.id)}</span>
      </div>
      <button
        class="button button--outline button--sm button--icon-only card-detail__id-copy"
        type="button"
        data-action="copy-card-id"
        aria-label="Скопировать ID карточки"
        title="Скопировать ID карточки"
      >
        ${copyIconSvg}
      </button>
    </div>
    <div class="card-detail__preview">
      ${renderPreview(card)}
    </div>
    <div class="detail-actions">
      <button
        class="${reminderButtonTone}"
        type="button"
        data-action="send-reminder-now"
        ${canSendReminder ? '' : 'disabled'}
      >
      ${canSendReminder ? '🔔 Напомнить сейчас' : '🔕 Напоминание недоступно'}
      </button>
      ${hasMessageLink ? '' : '<p class="detail-note">Сейчас ссылка на сообщение недоступна. Доступность проверим в следующей версии.</p>'}
      <button
        class="${hasMessageLink
          ? 'button button--outline'
          : 'button button--outline button--ghost'}"
        type="button"
        data-action="copy-message-link"
        ${hasMessageLink ? '' : 'disabled'}
      >
        Скопировать ссылку
      </button>
      <button class="${actionTone}" type="button" data-action="toggle-archive">
        ${actionLabel}
      </button>
    </div>
    <details class="detail-disclosure">
      <summary>История</summary>
      ${renderHistory(card)}
    </details>
    <details class="detail-disclosure">
      <summary>Дополнительно</summary>
      ${renderAdditionalDetails(card)}
    </details>
  `;
};

const renderNotificationDetail = (card) => {
  if (!notificationDetailContent) return;

  const notificationText = '🔔 Время повторить запись';
  const sentAt = formatDateTime(card.lastNotificationAt);
  const reason = notificationReasonLabel[card.lastNotificationReason] || formatValue(card.lastNotificationReason);
  const deliveryMode = card.baseChannelMessageId ? 'reply к базовому сообщению' : 'отдельным сообщением';
  const detailRows = [
    ['Текст уведомления', notificationText],
    ['Отправлено', sentAt],
    ['Причина', reason],
    ['Режим', deliveryMode],
    ['Telegram message_id', formatValue(card.lastNotificationMessageId)],
    ['Base message_id', formatValue(card.baseChannelMessageId)],
    ['Pending message_id', formatValue(card.pendingChannelMessageId)],
  ];

  notificationDetailContent.innerHTML = `
    <div class="card-detail__header">
      <span class="status-chip status-chip--learning">🔔 Уведомление</span>
      <span class="card-detail__next">Сработало для карточки</span>
    </div>
    <div class="card-detail__id-row">
      <div class="card-detail__id-meta">
        <span class="card-detail__id-label">ID карточки</span>
        <span class="card-detail__id-value">${escapeHtml(card.id)}</span>
      </div>
      <button
        class="button button--outline button--sm button--icon-only card-detail__id-copy"
        type="button"
        data-action="copy-card-id"
        aria-label="Скопировать ID карточки"
        title="Скопировать ID карточки"
      >
        ${copyIconSvg}
      </button>
    </div>
    <div class="card-detail__preview">
      <div class="card-detail__preview-text">${escapeHtml(notificationText)}</div>
      <div class="detail-note">Отдельная страница без табов. Здесь видно, что именно ушло и к какой карточке это относится.</div>
    </div>
    <div class="detail-grid">
      ${detailRows
        .map(
          ([label, value]) => `
        <div class="detail-row">
          <span class="detail-label">${escapeHtml(label)}</span>
          <span class="detail-value">${escapeHtml(String(value))}</span>
        </div>
      `,
        )
        .join('')}
    </div>
    <div class="card-detail__preview">
      ${renderPreview(card)}
    </div>
  `;
};

const openNotificationDetail = async (cardId) => {
  const card = await loadCardById(cardId);
  if (!card) {
    tg.showAlert('Карточка не найдена. Попробуйте обновить список.');
    return;
  }

  currentCardId = cardId;
  renderNotificationDetail(card);
  switchView('notification-detail');
};

const refreshNotificationDetail = () => {
  if (!currentCardId) return;
  const card = cardsData.find((item) => item.id === currentCardId);
  if (!card) return;
  renderNotificationDetail(card);
};

const toggleArchiveCard = async (cardId, actionButton = null) => {
  const card = cardsData.find((item) => item.id === cardId);
  if (!card) {
    tg.showAlert('Карточка не найдена.');
    return false;
  }

  const isArchived = card.status === 'archived';
  const key = `${String(cardId)}:toggle-archive`;
  if (actionLocks.has(key)) {
    return false;
  }

  actionLocks.add(key);
  try {
    const confirmed = await confirmArchiveChange(isArchived);
    if (!confirmed) {
      return false;
    }

    setBusyButtonState(actionButton, true, 'Обновляю…');
    try {
      const status = isArchived ? 'learning' : 'archived';
      await updateCardStatus(cardId, status);
      await loadCards();
      return true;
    } catch (error) {
      await loadCards();
      throw error;
    } finally {
      setBusyButtonState(actionButton, false);
    }
  } finally {
    actionLocks.delete(key);
  }
};

const sendReminderNow = async (cardId, actionButton = null) => {
  const card = cardsData.find((item) => item.id === cardId);
  if (!card) {
    tg.showAlert('Карточка не найдена.');
    return false;
  }

  if (card.status === 'pending') {
    tg.showAlert('Сначала активируйте карточку в боте или через оценку.');
    return false;
  }

  if (card.status === 'archived') {
    tg.showAlert('Верните карточку из архива перед отправкой напоминания.');
    return false;
  }

  const key = `${String(cardId)}:send-reminder`;
  if (actionLocks.has(key)) {
    return false;
  }

  actionLocks.add(key);
  try {
    const confirmed = await showConfirmDialog({
      title: 'Отправить напоминание сейчас?',
      body: 'Кликните «Отправить», и я сразу перешлю напоминание в ваш Telegram.',
      confirmLabel: 'Отправить',
      cancelLabel: 'Отмена',
      confirmTone: 'primary',
    });
    if (!confirmed) {
      return false;
    }

    setBusyButtonState(actionButton, true, 'Отправляю...');
    try {
      await apiCall(`/api/miniapp/cards/${cardId}/send-reminder`, {
        method: 'POST',
      });

      if (typeof tg.HapticFeedback?.notificationOccurred === 'function') {
        tg.HapticFeedback.notificationOccurred('success');
      }

      tg.showAlert('Напоминание отправлено');
      await loadCards();
      if (currentView === 'card-detail' && currentCardId === cardId) {
        refreshCardDetail();
      }
      return true;
    } catch (error) {
      console.error('Failed to send reminder now', error);
      const parsedMessage = getErrorMessage(error);
      const parsedStatus = parseApiError(error).status;
      if (parsedStatus === 409) {
        tg.showAlert('Карточка ещё не активирована. Оцените хотя бы одну карточку, чтобы начать.');
        return false;
      }
      if (parsedStatus === 404) {
        tg.showAlert('Карточка не найдена или была удалена.');
        return false;
      }
      tg.showAlert(`Не удалось отправить напоминание: ${parsedMessage}`);
      return false;
    } finally {
      setBusyButtonState(actionButton, false);
    }
  } finally {
    actionLocks.delete(key);
  }
};

// Attach swipe listeners using CardSwipe module
function attachSwipeListeners() {
  const cardsList = document.getElementById('cardsList');
  if (window.CardSwipe) {
    window.CardSwipe.attachSwipeListeners(cardsList, toggleArchiveCard, toggleArchiveCard);
  }
}

function openCardDetail(cardId) {
  const card = cardsData.find(c => c.id === cardId);
  if (!card) {
    tg.showAlert('Карточка не найдена. Попробуйте обновить список.');
    return;
  }

  currentCardId = cardId;
  renderCardDetail(card);
  switchView('card-detail');
}

function refreshCardDetail() {
  if (!currentCardId) return;
  const card = cardsData.find((item) => item.id === currentCardId);
  if (!card) return;
  renderCardDetail(card);
}

// Calendar view
let calendarCards = [];
let calendarMonth = new Date(); // current viewed month
let calendarSelectedDate = null; // YYYY-MM-DD or null

function toDateKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function groupCardsByDate(cards) {
  const byDate = {};
  cards.forEach(card => {
    if (!card.nextReviewAt) return;
    if (Number.isNaN(new Date(card.nextReviewAt).getTime())) {
      return;
    }
    const key = toDateKey(card.nextReviewAt);
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(card);
  });
  return byDate;
}

function renderMonthGrid(year, month, byDate) {
  const monthNames = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  // Monday=0 based
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const todayKey = toDateKey(new Date());

  let cells = '';
  // empty cells before first day
  for (let i = 0; i < startDow; i++) {
    cells += '<div class="cal-cell cal-cell--empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = (byDate[key] || []).length;
    const isToday = key === todayKey;
    const isSelected = key === calendarSelectedDate;
    let cls = 'cal-cell';
    if (isToday) cls += ' cal-cell--today';
    if (isSelected) cls += ' cal-cell--selected';
    if (count > 0) cls += ' cal-cell--has-cards';

    cells += `
      <div class="${cls}" data-date="${key}">
        <span class="cal-cell__day">${d}</span>
        ${count > 0 ? `<span class="cal-cell__count">${count}</span>` : ''}
      </div>
    `;
  }

  return `
    <div class="cal-nav">
      <button class="cal-nav__btn" data-action="prev-month" type="button">&larr;</button>
      <span class="cal-nav__title">${monthNames[month]} ${year}</span>
      <button class="cal-nav__btn" data-action="next-month" type="button">&rarr;</button>
    </div>
    <div class="cal-grid">
      ${dayNames.map(n => `<div class="cal-cell cal-cell--header">${n}</div>`).join('')}
      ${cells}
    </div>
  `;
}

function renderDayCards(dateKey, byDate) {
  const cards = byDate[dateKey] || [];
  if (cards.length === 0) return '';

  const formatted = new Date(dateKey + 'T00:00:00').toLocaleDateString('ru', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return `
    <div class="calendar-day">
      <div class="calendar-day__header">
        <span>${formatted}</span>
        <span class="calendar-day__count">${cards.length}</span>
      </div>
        <div class="calendar-day__cards">
          ${cards
            .sort((a, b) => new Date(a.nextReviewAt) - new Date(b.nextReviewAt))
            .map(card => {
            const time = formatTimeOnly(card.nextReviewAt);
            return `<div class="calendar-card" data-card-id="${card.id}">
              <span class="calendar-card__time">${time}</span>
              <span class="calendar-card__text">${escapeHtml(card.contentPreview || 'Без текста')}</span>
            </div>`;
          }).join('')}
      </div>
    </div>
  `;
}

function renderCalendar() {
  const calendarContent = document.getElementById('calendarContent');
  const byDate = groupCardsByDate(calendarCards);
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  const monthGrid = renderMonthGrid(year, month, byDate);

  let daysHtml = '';
  if (calendarSelectedDate) {
    daysHtml = renderDayCards(calendarSelectedDate, byDate);
  } else {
    // Show all days with cards in this month, sorted
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const daysWithCards = Object.keys(byDate)
      .filter(k => k.startsWith(monthPrefix))
      .sort();
    if (daysWithCards.length > 0) {
      daysHtml = daysWithCards.map(k => renderDayCards(k, byDate)).join('');
    }
  }

  const html = `
    <div class="calendar__month-wrapper">
      <div class="calendar__slider">
        <div class="calendar__month-container">
          ${monthGrid}
        </div>
      </div>
    </div>
    <div class="calendar__days-wrapper">
      ${daysHtml}
    </div>
  `;

  calendarContent.innerHTML = html;

  // Set initial height
  requestAnimationFrame(() => {
    const wrapper = calendarContent.querySelector('.calendar__month-wrapper');
    const container = calendarContent.querySelector('.calendar__month-container');
    if (wrapper && container) {
      wrapper.style.height = container.offsetHeight + 'px';
    }
  });
}

async function loadCalendar() {
  const calendarContent = document.getElementById('calendarContent');
  calendarContent.innerHTML = '<div class="loading">Загрузка календаря...</div>';

  try {
    const result = await apiCall('/api/miniapp/cards?status=learning');
    calendarCards = result.data || [];

    if (calendarCards.filter(c => c.nextReviewAt).length === 0) {
      calendarContent.innerHTML = `
        <div class="empty">
          <div class="empty__icon">📅</div>
          <div class="empty__text">Нет запланированных повторений</div>
          <div class="empty__subtext">Ровно в тот момент, когда нужно повторить, тут появятся дни с карточками.</div>
        </div>
      `;
      return;
    }

    calendarSelectedDate = null;
    renderCalendar();
  } catch (error) {
    console.error('Error loading calendar:', error);
    const safeMessage = getErrorMessage(error);
    calendarContent.innerHTML = `
      <div class="empty">
        <div class="empty__icon">⚠️</div>
        <div class="empty__text">Не удалось загрузить календарь</div>
        <div class="empty__subtext">${escapeHtml(safeMessage)}</div>
      </div>
    `;
  }
}

// Stats view
async function loadStats() {
  const statsContent = document.getElementById('statsContent');
  statsContent.innerHTML = '<div class="loading">Загрузка статистики...</div>';
  
  try {
    const result = await apiCall('/api/miniapp/stats');
    const stats = result.data;
    statsContent.innerHTML = `
      <div class="stat-card">
        <div class="stat-card__title">Общая картина</div>
        <div class="stat-card__value">${stats.total}</div>
        <div class="stat-card__subtitle">всех карточек в аккаунте</div>
      </div>

      <div class="stat-card">
        <div class="stat-card__title">Готовы к повторению</div>
        <div class="stat-card__value">${stats.dueToday}</div>
        <div class="stat-card__subtitle">сегодня</div>
      </div>
      
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card__title">⏳ Ожидают</div>
          <div class="stat-card__value">${stats.pending}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__title">📖 Изучаются</div>
          <div class="stat-card__value">${stats.learning}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__title">⏱️ Ждут оценки</div>
          <div class="stat-card__value">${stats.awaitingGrade}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__title">📦 Архив</div>
          <div class="stat-card__value">${stats.archived}</div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading stats:', error);
    const safeMessage = getErrorMessage(error);
    statsContent.innerHTML = `
      <div class="empty">
        <div class="empty__icon">⚠️</div>
        <div class="empty__text">Не удалось загрузить статистику</div>
        <div class="empty__subtext">${escapeHtml(safeMessage)}</div>
      </div>
    `;
  }
}

// Utility
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event listeners
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    switchView(tab.dataset.view);
  });
});

cardsListElement.addEventListener('click', (event) => {
  const showMoreButton = event.target.closest('[data-action="show-more-cards"]');
  if (showMoreButton) {
    visibleCardsLimit += CARD_RENDER_BATCH_SIZE;
    renderVisibleCards();
    return;
  }

  const inlineSendReminderButton = event.target.closest('[data-action="send-reminder-inline"]');
  if (inlineSendReminderButton) {
    event.preventDefault();
    event.stopPropagation();
    const cardId = inlineSendReminderButton.dataset.cardId;
    void sendReminderNow(cardId, inlineSendReminderButton);
    return;
  }

  const inlineArchiveButton = event.target.closest('[data-action="toggle-archive-inline"]');
  if (inlineArchiveButton) {
    event.preventDefault();
    event.stopPropagation();
    void toggleArchiveCard(inlineArchiveButton.dataset.cardId, inlineArchiveButton);
    return;
  }

  const cardElement = event.target.closest('.card');
  if (!cardElement || !cardElement.dataset.cardId) {
    return;
  }
  openCardDetail(cardElement.dataset.cardId);
});

cardsListElement.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) {
    return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) return;

  const cardElement = event.target.closest('.card');
  if (!cardElement || !cardElement.dataset.cardId) {
    return;
  }
  event.preventDefault();
  openCardDetail(cardElement.dataset.cardId);
});

if (cardBackBtn) {
  cardBackBtn.addEventListener('click', () => switchView('cards'));
}

if (notificationBackBtn) {
  notificationBackBtn.addEventListener('click', () => switchView('cards'));
}

if (cardDetailContent) {
  cardDetailContent.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    if (!currentCardId) return;

    const card = cardsData.find((item) => item.id === currentCardId);
    if (!card) return;

    if (actionButton.dataset.action === 'toggle-archive') {
      try {
        const updated = await toggleArchiveCard(card.id, actionButton);
        if (updated) {
          refreshCardDetail();
        }
      } catch (error) {
        console.error('Failed to update card status', error);
        tg.showAlert('Не удалось обновить карточку');
      }
    }

    if (actionButton.dataset.action === 'send-reminder-now') {
      await sendReminderNow(card.id, actionButton);
      return;
    }

    if (actionButton.dataset.action === 'copy-message-link') {
      const link = getMessageLink(card);
      if (!link) {
        tg.showAlert('Ссылка пока недоступна');
        return;
      }

      await runButtonAction(
        { cardId: card.id, action: 'copy-link', button: actionButton, pendingText: 'Копирую…' },
        async () => {
          const copied = await copyToClipboard(link);
          if (copied) {
            if (typeof tg.HapticFeedback?.notificationOccurred === 'function') {
              tg.HapticFeedback.notificationOccurred('success');
            }
            tg.showAlert('Ссылка скопирована');
            return;
          }
          tg.showAlert('Не удалось скопировать ссылку');
        }
      );
      return;
    }

    if (actionButton.dataset.action === 'copy-card-id') {
      const copied = await copyToClipboard(card.id);
      if (copied) {
        if (typeof tg.HapticFeedback?.notificationOccurred === 'function') {
          tg.HapticFeedback.notificationOccurred('success');
        }
        tg.showAlert('ID карточки скопирован');
      } else {
        tg.showAlert('Не удалось скопировать ID карточки');
      }
    }
  });
}

if (notificationDetailContent) {
  notificationDetailContent.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    if (!currentCardId) return;

    const card = cardsData.find((item) => item.id === currentCardId);
    if (!card) return;

    if (actionButton.dataset.action === 'copy-card-id') {
      const copied = await copyToClipboard(card.id);
      if (copied) {
        if (typeof tg.HapticFeedback?.notificationOccurred === 'function') {
          tg.HapticFeedback.notificationOccurred('success');
        }
        tg.showAlert('ID карточки скопирован');
      } else {
        tg.showAlert('Не удалось скопировать ID карточки');
      }
    }
  });
}

document.addEventListener(
  'error',
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement || target instanceof HTMLVideoElement)) {
      return;
    }
    if (!target.classList.contains('media-preview')) {
      return;
    }
    const wrapper = target.closest('.card-detail__preview');
    target.remove();
    if (wrapper && !wrapper.querySelector('.media-error')) {
      const note = document.createElement('div');
      note.className = 'card-detail__preview-text media-error';
      note.textContent = 'Медиа недоступно для предпросмотра.';
      wrapper.appendChild(note);
    }
  },
  true,
);

statusFilterElement?.addEventListener('change', (e) => {
  currentFilter = e.target.value;
  currentSearchQuery = '';
  visibleCardsLimit = CARD_RENDER_BATCH_SIZE;
  if (cardsSearchInputElement) {
    cardsSearchInputElement.value = '';
  }
  loadCards();
});

cardsSearchInputElement?.addEventListener('input', (e) => {
  currentSearchQuery = e.target.value || '';
  visibleCardsLimit = CARD_RENDER_BATCH_SIZE;
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    renderVisibleCards();
  }, 220);
});

cardsRefreshButton?.addEventListener('click', (event) => {
  const button = event.target instanceof HTMLButtonElement ? event.target : null;
  void runButtonAction(
    { cardId: 'global', action: 'refresh-cards', button, pendingText: 'Обновляю…' },
    () => loadCards(),
  );
});

cardsClearFiltersButton?.addEventListener('click', () => {
  currentFilter = '';
  currentSearchQuery = '';
  currentSortMode = 'nextReviewAsc';
  visibleCardsLimit = CARD_RENDER_BATCH_SIZE;
  if (statusFilterElement) statusFilterElement.value = '';
  if (cardsSearchInputElement) cardsSearchInputElement.value = '';
  if (cardsSortElement) cardsSortElement.value = 'nextReviewAsc';
  loadCards();
});

cardsSortElement?.addEventListener('change', (e) => {
  currentSortMode = e.target.value;
  visibleCardsLimit = CARD_RENDER_BATCH_SIZE;
  renderVisibleCards();
});

document.addEventListener('DOMContentLoaded', () => {
  updateCardsHint(0, false);
});

// Helper function to animate calendar month transition
function animateMonthTransition(direction) {
  const calendarContent = document.getElementById('calendarContent');
  const wrapper = calendarContent.querySelector('.calendar__month-wrapper');
  const slider = calendarContent.querySelector('.calendar__slider');
  const container = calendarContent.querySelector('.calendar__month-container');

  if (!wrapper || !slider || !container) {
    // Fallback if elements not found
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + direction, 1);
    calendarSelectedDate = null;
    renderCalendar();
    return;
  }

  // Create next/prev month element
  const byDate = groupCardsByDate(calendarCards);
  const nextYear = calendarMonth.getFullYear();
  const nextMonth = calendarMonth.getMonth() + direction;
  const targetDate = new Date(nextYear, nextMonth, 1);
  const nextMonthGrid = renderMonthGrid(targetDate.getFullYear(), targetDate.getMonth(), byDate);

  const tempContainer = document.createElement('div');
  tempContainer.className = 'calendar__month-container';
  tempContainer.innerHTML = nextMonthGrid;

  // Add to slider
  if (direction > 0) {
    slider.appendChild(tempContainer);
  } else {
    slider.insertBefore(tempContainer, container);
    slider.style.transform = 'translateX(-100%)';
  }

  // Get heights
  const currentHeight = container.offsetHeight;
  const nextHeight = tempContainer.offsetHeight;
  wrapper.style.height = currentHeight + 'px';

  // Animate
  requestAnimationFrame(() => {
    wrapper.style.height = nextHeight + 'px';
    slider.style.transform = direction > 0 ? 'translateX(-100%)' : 'translateX(0)';

    setTimeout(() => {
      calendarMonth = targetDate;
      calendarSelectedDate = null;
      renderCalendar();
    }, 300);
  });
}

// Helper function to update wrapper height
function updateCalendarHeight() {
  const calendarContent = document.getElementById('calendarContent');
  const wrapper = calendarContent.querySelector('.calendar__month-wrapper');
  const container = calendarContent.querySelector('.calendar__month-container');

  if (wrapper && container) {
    wrapper.style.height = container.offsetHeight + 'px';
  }
}

// Calendar interactions
document.getElementById('calendarContent').addEventListener('click', (event) => {
  const navBtn = event.target.closest('[data-action="prev-month"], [data-action="next-month"]');
  if (navBtn) {
    const dir = navBtn.dataset.action === 'prev-month' ? -1 : 1;
    animateMonthTransition(dir);
    return;
  }

  const cell = event.target.closest('.cal-cell[data-date]');
  if (cell) {
    const dateKey = cell.dataset.date;
    calendarSelectedDate = calendarSelectedDate === dateKey ? null : dateKey;
    renderCalendar();
    return;
  }

  const cardEl = event.target.closest('.calendar-card[data-card-id]');
  if (cardEl) {
    const cardId = cardEl.dataset.cardId;
    const card = calendarCards.find(c => c.id === cardId);
    if (card) {
      // Make sure card is in cardsData for detail view
      if (!cardsData.find(c => c.id === cardId)) {
        cardsData.push(card);
      }
      openCardDetail(cardId);
    }
  }
});

const initialLoad = () => {
  if (initialDeepLink?.type === 'notification') {
    void openNotificationDetail(initialDeepLink.cardId);
    deepLinkHandled = true;
    return;
  }
  if (initialDeepLink?.type === 'view' && initialDeepLink.view !== 'cards') {
    switchView(initialDeepLink.view);
    deepLinkHandled = true;
    return;
  }
  loadCards();
};

// Initial load
initialLoad();
