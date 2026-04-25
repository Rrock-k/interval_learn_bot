const buildMessageLink = (chatIdRaw, messageIdRaw) => {
  if (chatIdRaw === null || chatIdRaw === undefined || messageIdRaw === null || messageIdRaw === undefined) {
    return null;
  }

  if (chatIdRaw === '') {
    return null;
  }

  const chatId = String(chatIdRaw).trim();
  if (!/^[-]?\d+$/.test(chatId)) {
    return null;
  }

  const messageId = Number(messageIdRaw);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return null;
  }

  if (/^-100\d+$/.test(chatId)) {
    return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  }

  if (chatId.startsWith('-')) {
    return null;
  }

  return `tg://openmessage?user_id=${chatId}&message_id=${messageId}`;
};

const getMessageLink = (card) => {
  if (!card) return null;
  if (card.status === 'awaiting_grade') {
    const pendingLink = buildMessageLink(card.pendingChannelId, card.pendingChannelMessageId);
    if (pendingLink) return pendingLink;
  }
  return buildMessageLink(card.sourceChatId, card.sourceMessageId);
};

if (typeof window !== 'undefined') {
  window.buildMessageLink = buildMessageLink;
  window.getMessageLink = getMessageLink;
}

if (typeof module !== 'undefined') {
  module.exports = { buildMessageLink, getMessageLink };
}
