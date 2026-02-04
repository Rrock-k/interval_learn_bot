// Telegram WebApp initialization
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Apply Telegram theme
document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#ffffff');
document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#000000');
document.documentElement.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color || '#999999');
document.documentElement.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color || '#2481cc');
document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color || '#2481cc');
document.documentElement.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color || '#ffffff');
document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', tg.themeParams.secondary_bg_color || '#f4f4f5');

// State
let currentView = 'cards';
let cardsData = [];
let currentFilter = '';
let currentCardId = null;

const getStartParamRaw = () => {
  const fromInitData = tg?.initDataUnsafe?.start_param;
  if (fromInitData) return fromInitData;

  const searchParams = new URLSearchParams(window.location.search);
  const fromSearch = searchParams.get('tgWebAppStartParam');
  if (fromSearch) return fromSearch;

  if (window.location.hash) {
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const queryIndex = hash.indexOf('?');
    if (queryIndex !== -1) {
      const hashQuery = hash.slice(queryIndex + 1);
      const hashParams = new URLSearchParams(hashQuery);
      const fromHash = hashParams.get('tgWebAppStartParam');
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

const notificationReasonLabel = {
  scheduled: 'по расписанию',
  manual_now: 'вручную',
  manual_override: 'дата вручную',
};

// API helper
async function apiCall(endpoint, options = {}) {
  // Debug logging
  console.log('[API] Calling:', endpoint);
  console.log('[API] initData exists:', !!tg.initData);
  console.log('[API] initData length:', tg.initData?.length || 0);
  
  if (!tg.initData) {
    console.error('[API] No initData available!');
    throw new Error('Telegram initData не доступен. Откройте приложение через бота.');
  }
  
  const url = `${window.location.origin}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg.initData,
  };
  
  console.log('[API] Request URL:', url);
  console.log('[API] Headers:', { 'Content-Type': headers['Content-Type'], 'X-Telegram-Init-Data': 'exists' });
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    
    console.log('[API] Response status:', response.status);
    console.log('[API] Response ok:', response.ok);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Error response:', errorText);
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    console.log('[API] Success:', data);
    return data;
  } catch (error) {
    console.error('[API] Exception:', error);
    throw error;
  }
}

// View switching
function switchView(viewName) {
  currentView = viewName;
  const activeTabView = viewName === 'card-detail' ? 'cards' : viewName;
  if (viewName !== 'card-detail') {
    currentCardId = null;
  }
  
  // Update tabs
  document.querySelectorAll('.tab').forEach(tab => {
    const isActive = tab.dataset.view === activeTabView;
    tab.classList.toggle('tab--active', isActive);
  });
  
  // Update views
  document.querySelectorAll('.view').forEach(view => {
    const isActive = view.dataset.view === viewName;
    view.classList.toggle('view--active', isActive);
  });
  
  // Load view content
  if (viewName === 'cards') {
    loadCards();
  } else if (viewName === 'calendar') {
    // Reset calendar to current month when switching to calendar view
    calendarMonth = new Date();
    calendarSelectedDate = null;
    loadCalendar();
  } else if (viewName === 'stats') {
    loadStats();
  }
}

const handleDeepLinkAfterCardsLoad = () => {
  if (deepLinkHandled || !initialDeepLink) return false;
  if (initialDeepLink.type !== 'card') return false;

  const targetCard = cardsData.find((card) => card.id === initialDeepLink.cardId);
  if (!targetCard) {
    tg.showAlert('Карточка не найдена. Возможно, она удалена или доступ ограничен.');
    deepLinkHandled = true;
    return true;
  }

  openCardDetail(targetCard.id);
  deepLinkHandled = true;
  return true;
};

// Cards view
async function loadCards() {
  const cardsList = document.getElementById('cardsList');
  cardsList.innerHTML = '<div class="loading">Загрузка...</div>';
  
  try {
    const params = currentFilter ? `?status=${currentFilter}` : '';
    const result = await apiCall(`/api/miniapp/cards${params}`);
    cardsData = result.data || [];

    handleDeepLinkAfterCardsLoad();
    
    if (cardsData.length === 0) {
      cardsList.innerHTML = `
        <div class="empty">
          <div class="empty__icon">📚</div>
          <div class="empty__text">Карточек пока нет</div>
        </div>
      `;
      return;
    }
    
    cardsList.innerHTML = cardsData.map(card => renderCard(card)).join('');
    attachSwipeListeners();
  } catch (error) {
    console.error('Error loading cards:', error);
    cardsList.innerHTML = `
      <div class="empty">
        <div class="empty__icon">⚠️</div>
        <div class="empty__text">Ошибка загрузки карточек</div>
        <div class="empty__text" style="font-size: 12px; margin-top: 8px;">${escapeHtml(error.message)}</div>
      </div>
    `;
  }
}

function renderCard(card) {
  const nextReview = card.nextReviewAt 
    ? new Date(card.nextReviewAt).toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
  
  const isArchived = card.status === 'archived';
  const swipeLabel = isArchived ? '↩️ Вернуть' : '📦 Архив';
  const repetitionValue = Number.isFinite(card.repetition) ? card.repetition : 0;
  
  return `
    <div class="card-swipe-container" data-card-id="${card.id}" data-archived="${isArchived}">
      <div class="card-swipe-background">
        <div class="card-swipe-background__content">${swipeLabel}</div>
      </div>
      <div class="card" data-card-id="${card.id}">
        <div class="card__header">
          <span class="card__status">${statusEmoji[card.status]} ${statusName[card.status]}</span>
          <span class="card__date">${nextReview}</span>
        </div>
        <div class="card__content">${escapeHtml(card.contentPreview || 'Без текста')}</div>
        <div class="card__meta">
          <span class="card__meta-item">🔁 ${repetitionValue}</span>
        </div>
      </div>
    </div>
  `;
}

const formatDateTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return String(value);
};

const getMessageLink = (card) => {
  if (!card?.sourceChatId || !card?.sourceMessageId) return null;
  const chatId = String(card.sourceChatId);
  const messageId = card.sourceMessageId;

  if (chatId.startsWith('-100')) {
    const internalId = chatId.slice(4);
    return `https://t.me/c/${internalId}/${messageId}`;
  }

  if (chatId.startsWith('-')) {
    return null;
  }

  return `tg://openmessage?user_id=${chatId}&message_id=${messageId}`;
};

const openTelegramLink = (url) => {
  if (!url) return;
  if (typeof tg.openTelegramLink === 'function') {
    tg.openTelegramLink(url);
    return;
  }
  window.location.href = url;
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
    confirmConfirm.classList.remove('primary-button', 'danger-button');
    confirmConfirm.classList.add(confirmTone === 'danger' ? 'danger-button' : 'primary-button');

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

const requestArchiveChange = async (cardId, isArchived) => {
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

  const status = isArchived ? 'learning' : 'archived';
  await updateCardStatus(cardId, status);
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
    ['ID карточки', formatValue(card.id)],
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
  const actionLabel = isArchived ? 'Разархивировать' : 'Архивировать';
  const actionTone = isArchived ? 'secondary-button' : 'danger-button';

  cardDetailContent.innerHTML = `
    <div class="card-detail__header">
      <span class="status-pill">${escapeHtml(statusText)}</span>
      <span class="card-detail__next">След. повтор: ${escapeHtml(nextReview)}</span>
    </div>
    <div class="card-detail__preview">
      ${renderPreview(card)}
    </div>
    <div class="detail-actions">
      <button class="primary-button" type="button" data-action="open-message">
        Перейти к карточке
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

// Archive card via API
async function archiveCard(cardId) {
  try {
    const card = cardsData.find((item) => item.id === cardId);
    const isArchived = card ? card.status === 'archived' : false;
    const updated = await requestArchiveChange(cardId, isArchived);
    if (updated) {
      loadCards();
    } else {
      loadCards(); // reset swipe state if canceled
    }
  } catch (error) {
    console.error('Failed to archive card', error);
    tg.showAlert('Не удалось архивировать карточку');
    loadCards(); // Reload to reset UI
  }
}

// Restore card from archive via API
async function restoreCard(cardId) {
  try {
    const card = cardsData.find((item) => item.id === cardId);
    const isArchived = card ? card.status === 'archived' : true;
    const updated = await requestArchiveChange(cardId, isArchived);
    if (updated) {
      loadCards();
    } else {
      loadCards();
    }
  } catch (error) {
    console.error('Failed to restore card', error);
    tg.showAlert('Не удалось вернуть карточку');
    loadCards(); // Reload to reset UI
  }
}

// Attach swipe listeners using CardSwipe module
function attachSwipeListeners() {
  const cardsList = document.getElementById('cardsList');
  if (window.CardSwipe) {
    window.CardSwipe.attachSwipeListeners(cardsList, archiveCard, restoreCard);
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
            const time = new Date(card.nextReviewAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
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
        </div>
      `;
      return;
    }

    calendarSelectedDate = null;
    renderCalendar();
  } catch (error) {
    console.error('Error loading calendar:', error);
    calendarContent.innerHTML = `
      <div class="empty">
        <div class="empty__icon">⚠️</div>
        <div class="empty__text">Ошибка загрузки календаря</div>
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
        <div class="stat-card__title">Всего карточек</div>
        <div class="stat-card__value">${stats.total}</div>
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
      
      <div class="stat-card">
        <div class="stat-card__title">Готовы к повторению</div>
        <div class="stat-card__value">${stats.dueToday}</div>
        <div class="stat-card__subtitle">сегодня</div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading stats:', error);
    statsContent.innerHTML = `
      <div class="empty">
        <div class="empty__icon">⚠️</div>
        <div class="empty__text">Ошибка загрузки статистики</div>
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

const cardsListElement = document.getElementById('cardsList');
cardsListElement.addEventListener('click', (event) => {
  const restoreButton = event.target.closest('[data-action="restore"]');
  if (restoreButton) {
    event.preventDefault();
    event.stopPropagation();
    restoreCard(restoreButton.dataset.cardId);
    return;
  }

  const cardElement = event.target.closest('.card');
  if (!cardElement || !cardElement.dataset.cardId) {
    return;
  }
  openCardDetail(cardElement.dataset.cardId);
});

if (cardBackBtn) {
  cardBackBtn.addEventListener('click', () => switchView('cards'));
}

if (cardDetailContent) {
  cardDetailContent.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    if (!currentCardId) return;

    const card = cardsData.find((item) => item.id === currentCardId);
    if (!card) return;

    if (actionButton.dataset.action === 'open-message') {
      const link = getMessageLink(card);
      if (!link) {
        tg.showAlert('Не удалось сформировать ссылку на сообщение.');
        return;
      }
      openTelegramLink(link);
      return;
    }

    if (actionButton.dataset.action === 'toggle-archive') {
      try {
        const updated = await requestArchiveChange(card.id, card.status === 'archived');
        if (updated) {
          refreshCardDetail();
        }
      } catch (error) {
        console.error('Failed to update card status', error);
        tg.showAlert('Не удалось обновить карточку');
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

document.getElementById('statusFilter').addEventListener('change', (e) => {
  currentFilter = e.target.value;
  loadCards();
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
  if (initialDeepLink?.type === 'view' && initialDeepLink.view !== 'cards') {
    switchView(initialDeepLink.view);
    deepLinkHandled = true;
    return;
  }
  loadCards();
};

// Initial load
initialLoad();
