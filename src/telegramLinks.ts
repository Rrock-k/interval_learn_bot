export const buildMiniAppDeepLink = (botUsername: string, startParam?: string) => {
  const encodedParam = startParam ? encodeURIComponent(startParam) : '';
  const query = encodedParam ? `?startapp=${encodedParam}` : '';
  return `https://t.me/${botUsername}${query}`;
};

export const buildMiniAppCardParam = (cardId: string) => `card_${cardId}`;
