// Card Swipe-to-Archive functionality

// Swipe state
let swipeState = {
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  isDragging: false,
  isScrolling: false,
  cardElement: null,
  cardId: null,
  isArchived: false,
};

// Touch event handlers
function handleTouchStart(e) {
  const card = e.target.closest('.card');
  if (!card) return;
  
  const container = card.closest('.card-swipe-container');
  if (!container) return;
  
  swipeState.isDragging = true;
  swipeState.isScrolling = false;
  swipeState.startX = e.touches[0].clientX;
  swipeState.startY = e.touches[0].clientY;
  swipeState.currentX = e.touches[0].clientX;
  swipeState.currentY = e.touches[0].clientY;
  swipeState.cardElement = card;
  swipeState.cardId = card.dataset.cardId;
  swipeState.isArchived = container.dataset.archived === 'true';
  
  card.style.transition = 'none';
}

function handleTouchMove(e) {
  if (!swipeState.isDragging || !swipeState.cardElement) return;
  
  swipeState.currentX = e.touches[0].clientX;
  swipeState.currentY = e.touches[0].clientY;
  const deltaX = swipeState.currentX - swipeState.startX;
  const deltaY = swipeState.currentY - swipeState.startY;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);
  const scrollThreshold = 10;
  const swipeThreshold = 6;

  if (!swipeState.isScrolling && absDeltaY > absDeltaX && absDeltaY > scrollThreshold) {
    swipeState.isScrolling = true;
    swipeState.cardElement.style.transition = 'transform 0.2s ease';
    swipeState.cardElement.style.transform = 'translateX(0)';
    const background = swipeState.cardElement.parentElement.querySelector('.card-swipe-background');
    if (background) {
      background.style.opacity = '0';
    }
    return;
  }

  if (swipeState.isScrolling || absDeltaX < swipeThreshold) {
    return;
  }
  
  // Allow left swipe to archive and right swipe to restore
  const isArchiveSwipe = !swipeState.isArchived && deltaX < 0;
  const isRestoreSwipe = swipeState.isArchived && deltaX > 0;
  if (!isArchiveSwipe && !isRestoreSwipe) return;

  swipeState.cardElement.style.transform = `translateX(${deltaX}px)`;

  const opacity = Math.min(Math.abs(deltaX) / 100, 1);
  const background = swipeState.cardElement.parentElement.querySelector('.card-swipe-background');
  if (background) {
    background.style.opacity = opacity;
  }
}

function handleTouchEnd(e, onArchiveCallback, onRestoreCallback) {
  if (!swipeState.isDragging || !swipeState.cardElement) return;
  
  const deltaX = swipeState.currentX - swipeState.startX;
  const absDeltaX = Math.abs(deltaX);
  const swipeDistanceThreshold = 100; // Swipe distance threshold in pixels
  
  swipeState.cardElement.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
  
  if (swipeState.isScrolling) {
    swipeState.cardElement.style.transform = 'translateX(0)';
    const background = swipeState.cardElement.parentElement.querySelector('.card-swipe-background');
    if (background) {
      background.style.opacity = '0';
    }
  } else if (!swipeState.isArchived && deltaX < -swipeDistanceThreshold) {
    // Archive the card
    swipeState.cardElement.style.transform = 'translateX(-100%)';
    swipeState.cardElement.style.opacity = '0';
    
    const cardId = swipeState.cardId;
    setTimeout(() => {
      if (onArchiveCallback) {
        onArchiveCallback(cardId);
      }
    }, 300);
  } else if (swipeState.isArchived && deltaX > swipeDistanceThreshold) {
    // Restore the card
    swipeState.cardElement.style.transform = 'translateX(100%)';
    swipeState.cardElement.style.opacity = '0';

    const cardId = swipeState.cardId;
    setTimeout(() => {
      if (onRestoreCallback) {
        onRestoreCallback(cardId);
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
  swipeState.isArchived = false;
  swipeState.isScrolling = false;
}

// Attach swipe listeners to a container
function attachSwipeListeners(containerElement, onArchiveCallback, onRestoreCallback) {
  if (!containerElement) return;
  
  // Remove existing listeners to prevent duplicates
  containerElement.removeEventListener('touchstart', handleTouchStart);
  containerElement.removeEventListener('touchmove', handleTouchMove);
  containerElement.removeEventListener('touchend', handleTouchEnd);
  
  // Attach new listeners
  containerElement.addEventListener('touchstart', handleTouchStart, { passive: true });
  containerElement.addEventListener('touchmove', handleTouchMove, { passive: false });
  containerElement.addEventListener(
    'touchend',
    (e) => handleTouchEnd(e, onArchiveCallback, onRestoreCallback),
    { passive: true },
  );
}

// Export for use in app.js
window.CardSwipe = {
  attachSwipeListeners,
};
