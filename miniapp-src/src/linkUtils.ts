export type MessageLinkCard = {
  status?: string | null;
  pendingChannelId?: string | number | null;
  pendingChannelMessageId?: string | number | null;
  sourceChatId?: string | number | null;
  sourceMessageId?: string | number | null;
};

export function buildMessageLink(
  chatIdRaw?: string | number | null,
  messageIdRaw?: string | number | null,
) {
  if (chatIdRaw === null || typeof chatIdRaw === 'undefined') return null;
  if (messageIdRaw === null || typeof messageIdRaw === 'undefined') return null;
  const chatId = String(chatIdRaw).trim();
  const messageId = Number(messageIdRaw);
  if (!Number.isInteger(messageId) || messageId <= 0) return null;
  if (/^-100\d+$/.test(chatId)) return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  if (/^\d+$/.test(chatId)) return `tg://openmessage?user_id=${chatId}&message_id=${messageId}`;
  return null;
}

export function getMessageLink(card: MessageLinkCard | null) {
  if (!card) return null;
  if (card.status === 'awaiting_grade') {
    const pendingLink = buildMessageLink(card.pendingChannelId, card.pendingChannelMessageId);
    if (pendingLink) return pendingLink;
  }
  return buildMessageLink(card.sourceChatId, card.sourceMessageId);
}
