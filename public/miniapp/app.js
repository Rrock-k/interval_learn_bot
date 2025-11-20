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
  
  // Update tabs
  document.querySelectorAll('.tab').forEach(tab => {
    const isActive = tab.dataset.view === viewName;
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
    loadCalendar();
  } else if (viewName === 'stats') {
    loadStats();
  }
}

// Cards view
async function loadCards() {
  const cardsList = document.getElementById('cardsList');
  cardsList.innerHTML = '<div class="loading">Загрузка...</div>';
  
  try {
    const params = currentFilter ? `?status=${currentFilter}` : '';
    const result = await apiCall(`/api/miniapp/cards${params}`);
    cardsData = result.data || [];
    
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
  
  const nextReview = card.nextReviewAt 
    ? new Date(card.nextReviewAt).toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
  
  return `
    <div class="card" onclick="openCard('${card.id}')">
      <div class="card__header">
        <span class="card__status">${statusEmoji[card.status]} ${statusName[card.status]}</span>
        <span class="card__date">${nextReview}</span>
      </div>
      <div class="card__content">${escapeHtml(card.contentPreview || 'Без текста')}</div>
      <div class="card__meta">
        <span class="card__meta-item">🔁 ${card.repetition}</span>
        <span class="card__meta-item">📅 ${card.interval} дн.</span>
        <span class="card__meta-item">⭐ ${card.easiness.toFixed(1)}</span>
      </div>
    </div>
  `;
}

function openCard(cardId) {
  const card = cardsData.find(c => c.id === cardId);
  if (!card) return;
  
  tg.showAlert(`Карточка: ${card.contentPreview}\n\nСледующее повторение: ${card.nextReviewAt || 'не запланировано'}`);
}

// Calendar view
async function loadCalendar() {
  const calendarContent = document.getElementById('calendarContent');
  calendarContent.innerHTML = '<div class="loading">Загрузка календаря...</div>';
  
  try {
    const result = await apiCall('/api/miniapp/cards?status=learning');
    const cards = result.data || [];
    
    // Group by date
    const byDate = {};
    cards.forEach(card => {
      if (!card.nextReviewAt) return;
      const date = new Date(card.nextReviewAt).toLocaleDateString('ru', { year: 'numeric', month: 'long', day: 'numeric' });
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(card);
    });
    
    if (Object.keys(byDate).length === 0) {
      calendarContent.innerHTML = `
        <div class="empty">
          <div class="empty__icon">📅</div>
          <div class="empty__text">Нет запланированных повторений</div>
        </div>
      `;
      return;
    }
    
    calendarContent.innerHTML = Object.entries(byDate)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .map(([date, cards]) => `
        <div class="calendar-day">
          <div class="calendar-day__header">
            <span>${date}</span>
            <span class="calendar-day__count">${cards.length}</span>
          </div>
          <div class="calendar-day__cards">
            ${cards.map(card => `
              <div class="calendar-card">${escapeHtml(card.contentPreview || 'Без текста')}</div>
            `).join('')}
          </div>
        </div>
      `).join('');
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

document.getElementById('statusFilter').addEventListener('change', (e) => {
  currentFilter = e.target.value;
  loadCards();
});

// Initial load
loadCards();
