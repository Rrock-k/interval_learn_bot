// Card Swipe-to-Archive functionality

// Swipe state
let swipeState = {
  startX: 0,
  currentX: 0,
  isDragging: false,
  cardElement: null,
  cardId: null,
};

// Touch event handlers
function handleTouchStart(e) {
  const card = e.target.closest('.card');
  if (!card) return;
  
  const container = card.closest('.card-swipe-container');
  if (!container || container.dataset.archived === 'true') return;
  
  swipeState.isDragging = true;
  swipeState.startX = e.touches[0].clientX;
  swipeState.currentX = e.touches[0].clientX;
  swipeState.cardElement = card;
  swipeState.cardId = card.dataset.cardId;
  
  card.style.transition = 'none';
}

function handleTouchMove(e) {
  if (!swipeState.isDragging || !swipeState.cardElement) return;
  
  swipeState.currentX = e.touches[0].clientX;
  const deltaX = swipeState.currentX - swipeState.startX;
  
  // Only allow left swipe
  if (deltaX < 0) {
    swipeState.cardElement.style.transform = `translateX(${deltaX}px)`;
    
    const opacity = Math.min(Math.abs(deltaX) / 100, 1);
    const background = swipeState.cardElement.parentElement.querySelector('.card-swipe-background');
    if (background) {
      background.style.opacity = opacity;
    }
  }
}

function handleTouchEnd(e, onArchiveCallback) {
  if (!swipeState.isDragging || !swipeState.cardElement) return;
  
  const deltaX = swipeState.currentX - swipeState.startX;
  const threshold = -100; // 100px swipe threshold
  
  swipeState.cardElement.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
  
  if (deltaX < threshold) {
    // Archive the card
    swipeState.cardElement.style.transform = 'translateX(-100%)';
    swipeState.cardElement.style.opacity = '0';
    
    const cardId = swipeState.cardId;
    setTimeout(() => {
      if (onArchiveCallback) {
        onArchiveCallback(cardId);
      }
    }, 300);
  } else {
    // Reset position
    swipeState.cardElement.style.transform = 'translateX(0)';
    const background = swipeState.cardElement.parentElement.querySelector('.card-swipe-background');
    if (background) {
      background.style.opacity = '0';
    }
  }
  
  swipeState.isDragging = false;
  swipeState.cardElement = null;
  swipeState.cardId = null;
}

// Attach swipe listeners to a container
function attachSwipeListeners(containerElement, onArchiveCallback) {
  if (!containerElement) return;
  
  // Remove existing listeners to prevent duplicates
  containerElement.removeEventListener('touchstart', handleTouchStart);
  containerElement.removeEventListener('touchmove', handleTouchMove);
  
  // Attach new listeners
  containerElement.addEventListener('touchstart', handleTouchStart, { passive: true });
  containerElement.addEventListener('touchmove', handleTouchMove, { passive: false });
  containerElement.addEventListener('touchend', (e) => handleTouchEnd(e, onArchiveCallback), { passive: true });
}

// Export for use in app.js
window.CardSwipe = {
  attachSwipeListeners,
};
