import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';

loadEnv();

type Candidate = {
  id: string;
  user_id: string;
  source_chat_id: string;
  source_message_id: number;
  content_type: string;
  content_preview: string;
  base_channel_message_id: number | null;
  pending_channel_message_id: number | null;
};

type Options = {
  apply: boolean;
  probe: boolean;
  keepBase: boolean;
  keepForwards: boolean;
  limit: number;
  cardId: string | null;
  userId: string | null;
  sourceChatId: string | null;
  targetChatId: string | null;
};

const usage = () => `
Usage:
  npm run recover:truncated-previews -- [options]

Modes:
  default       List DB candidates only. Does not call Telegram.
  --probe      Forward source messages to read full text/caption. Does not update DB.
  --apply      Forward source messages and update DB when recovery is safe.

Options:
  --limit N                 Max cards to inspect. Default: 20.
  --card-id ID              Inspect one card.
  --user-id USER_ID         Restrict candidates to one card owner.
  --source-chat-id CHAT_ID  Restrict candidates to one source chat.
  --target-chat-id CHAT_ID  Chat where temporary forwarded messages are created.
                           Defaults to RECOVERY_CHAT_ID, then CHAT_ID.
  --keep-base               Do not reset base_channel_message_id on update.
  --keep-forwards           Do not delete temporary forwarded messages.
  --help                    Show this help.

Safety:
  --probe and --apply create temporary forwarded Telegram messages.
  By default the script deletes temporary forwarded messages after reading them.
  --probe and --apply require --card-id, --user-id, or --source-chat-id.
  --apply updates only when recovered text starts with current 200-char preview.
`;

const readValueArg = (args: string[], index: number, name: string) => {
  const current = args[index]!;
  const inline = current.match(new RegExp(`^${name}=(.+)$`));
  if (inline) return { value: inline[1]!, consumed: 1 };
  const next = args[index + 1];
  if (!next || next.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return { value: next, consumed: 2 };
};

const parseOptions = (): Options => {
  const args = process.argv.slice(2);
  const options: Options = {
    apply: false,
    probe: false,
    keepBase: false,
    keepForwards: false,
    limit: 20,
    cardId: null,
    userId: null,
    sourceChatId: null,
    targetChatId: process.env.RECOVERY_CHAT_ID ?? process.env.CHAT_ID ?? null,
  };

  for (let index = 0; index < args.length; ) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      console.log(usage().trim());
      process.exit(0);
    }
    if (arg === '--apply') {
      options.apply = true;
      options.probe = true;
      index += 1;
      continue;
    }
    if (arg === '--probe') {
      options.probe = true;
      index += 1;
      continue;
    }
    if (arg === '--keep-base') {
      options.keepBase = true;
      index += 1;
      continue;
    }
    if (arg === '--keep-forwards') {
      options.keepForwards = true;
      index += 1;
      continue;
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const { value, consumed } = readValueArg(args, index, '--limit');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      options.limit = parsed;
      index += consumed;
      continue;
    }
    if (arg === '--card-id' || arg.startsWith('--card-id=')) {
      const { value, consumed } = readValueArg(args, index, '--card-id');
      options.cardId = value;
      options.limit = 1;
      index += consumed;
      continue;
    }
    if (arg === '--user-id' || arg.startsWith('--user-id=')) {
      const { value, consumed } = readValueArg(args, index, '--user-id');
      options.userId = value;
      index += consumed;
      continue;
    }
    if (arg === '--source-chat-id' || arg.startsWith('--source-chat-id=')) {
      const { value, consumed } = readValueArg(args, index, '--source-chat-id');
      options.sourceChatId = value;
      index += consumed;
      continue;
    }
    if (arg === '--target-chat-id' || arg.startsWith('--target-chat-id=')) {
      const { value, consumed } = readValueArg(args, index, '--target-chat-id');
      options.targetChatId = value;
      index += consumed;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.probe && !options.targetChatId) {
    throw new Error('--probe/--apply requires --target-chat-id, RECOVERY_CHAT_ID, or CHAT_ID');
  }
  if (options.probe && !options.cardId && !options.userId && !options.sourceChatId) {
    throw new Error('--probe/--apply requires --card-id, --user-id, or --source-chat-id to avoid cross-user forwarding');
  }

  return options;
};

const requireEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env ${key}`);
  }
  return value;
};

const createPool = () =>
  new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    ssl:
      process.env.PGSSLMODE === 'require' ||
      process.env.POSTGRES_SSL === 'require' ||
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : undefined,
  });

const listCandidates = async (pool: Pool, options: Options) => {
  const params: unknown[] = [];
  const where = [
    `content_preview IS NOT NULL`,
    `char_length(content_preview) = 200`,
  ];

  if (options.cardId) {
    params.push(options.cardId);
    where.push(`id = $${params.length}`);
  }
  if (options.userId) {
    params.push(options.userId);
    where.push(`user_id = $${params.length}`);
  }
  if (options.sourceChatId) {
    params.push(options.sourceChatId);
    where.push(`source_chat_id = $${params.length}`);
  }

  params.push(options.limit);
  const limitParam = `$${params.length}`;

  const { rows } = await pool.query<Candidate>(
    `
      SELECT
        id,
        user_id,
        source_chat_id,
        source_message_id,
        content_type,
        content_preview,
        base_channel_message_id,
        pending_channel_message_id
      FROM cards
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT ${limitParam}
    `,
    params,
  );

  return rows;
};

const forwardAndRecover = async ({
  botToken,
  targetChatId,
  candidate,
}: {
  botToken: string;
  targetChatId: string;
  candidate: Candidate;
}) => {
  const form = new URLSearchParams({
    chat_id: targetChatId,
    from_chat_id: candidate.source_chat_id,
    message_id: String(candidate.source_message_id),
    disable_notification: 'true',
  });

  const response = await fetch(`https://api.telegram.org/bot${botToken}/forwardMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const payload = (await response.json()) as {
    ok: boolean;
    description?: string;
    result?: {
      message_id: number;
      caption?: string;
      text?: string;
    };
  };

  if (!payload.ok || !payload.result) {
    return {
      ok: false,
      forwardedMessageId: null,
      recoveredPreview: null,
      safePrefixMatch: false,
      error: payload.description ?? `HTTP ${response.status}`,
    };
  }

  const rawPreview =
    typeof payload.result.caption === 'string'
      ? payload.result.caption
      : typeof payload.result.text === 'string'
        ? payload.result.text
        : '';
  const recoveredPreview = rawPreview.trim();
  const safePrefixMatch =
    recoveredPreview.length > candidate.content_preview.length &&
    recoveredPreview.startsWith(candidate.content_preview);

  return {
    ok: true,
    forwardedMessageId: payload.result.message_id,
    recoveredPreview: safePrefixMatch ? recoveredPreview : null,
    safePrefixMatch,
    error: null,
  };
};

const deleteForwardedMessage = async ({
  botToken,
  targetChatId,
  messageId,
}: {
  botToken: string;
  targetChatId: string;
  messageId: number;
}) => {
  const form = new URLSearchParams({
    chat_id: targetChatId,
    message_id: String(messageId),
  });

  const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const payload = (await response.json()) as {
    ok: boolean;
    description?: string;
  };

  return {
    ok: payload.ok,
    error: payload.ok ? null : payload.description ?? `HTTP ${response.status}`,
  };
};

const updateCard = async ({
  pool,
  candidate,
  recoveredPreview,
  keepBase,
}: {
  pool: Pool;
  candidate: Candidate;
  recoveredPreview: string;
  keepBase: boolean;
}) => {
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `
      UPDATE cards
      SET content_preview = $1,
          base_channel_message_id = ${keepBase ? 'base_channel_message_id' : 'NULL'},
          updated_at = $2
      WHERE id = $3
      RETURNING id, char_length(content_preview) AS preview_len, base_channel_message_id
    `,
    [recoveredPreview, now, candidate.id],
  );
  return rows[0] ?? null;
};

const main = async () => {
  const options = parseOptions();
  const pool = createPool();
  const botToken = options.probe ? requireEnv('BOT_TOKEN') : null;

  try {
    const candidates = await listCandidates(pool, options);
    console.log(
      JSON.stringify(
        {
          mode: options.apply ? 'apply' : options.probe ? 'probe' : 'list-only',
          count: candidates.length,
          limit: options.limit,
          targetChatId: options.probe ? options.targetChatId : null,
          filters: {
            cardId: options.cardId,
            userId: options.userId,
            sourceChatId: options.sourceChatId,
          },
        },
        null,
        2,
      ),
    );

    let recovered = 0;
    let updated = 0;
    let failed = 0;

    for (const candidate of candidates) {
      if (!options.probe) {
        console.log(
          JSON.stringify(
            {
              id: candidate.id,
              userId: candidate.user_id,
              source: `${candidate.source_chat_id}:${candidate.source_message_id}`,
              contentType: candidate.content_type,
              previewLength: candidate.content_preview.length,
              contentPreview: candidate.content_preview,
              baseChannelMessageId: candidate.base_channel_message_id,
              pendingChannelMessageId: candidate.pending_channel_message_id,
            },
            null,
            2,
          ),
        );
        continue;
      }

      const result = await forwardAndRecover({
        botToken: botToken!,
        targetChatId: options.targetChatId!,
        candidate,
      });
      const cleanup =
        result.forwardedMessageId && !options.keepForwards
          ? await deleteForwardedMessage({
              botToken: botToken!,
              targetChatId: options.targetChatId!,
              messageId: result.forwardedMessageId,
            })
          : null;

      if (!result.ok || !result.recoveredPreview) {
        failed += 1;
        console.log(
          JSON.stringify(
            {
              id: candidate.id,
              userId: candidate.user_id,
              source: `${candidate.source_chat_id}:${candidate.source_message_id}`,
              forwardedMessageId: result.forwardedMessageId,
              forwardedMessageDeleted: cleanup?.ok ?? null,
              forwardedMessageDeleteError: cleanup?.error ?? null,
              safePrefixMatch: result.safePrefixMatch,
              status: 'not_recovered',
              error: result.error,
            },
            null,
            2,
          ),
        );
        continue;
      }

      recovered += 1;
      let updateResult = null;
      if (options.apply) {
        updateResult = await updateCard({
          pool,
          candidate,
          recoveredPreview: result.recoveredPreview,
          keepBase: options.keepBase,
        });
        updated += 1;
      }

      console.log(
        JSON.stringify(
          {
            id: candidate.id,
            userId: candidate.user_id,
            source: `${candidate.source_chat_id}:${candidate.source_message_id}`,
            forwardedMessageId: result.forwardedMessageId,
            forwardedMessageDeleted: cleanup?.ok ?? null,
            forwardedMessageDeleteError: cleanup?.error ?? null,
            oldPreviewLength: candidate.content_preview.length,
            recoveredPreviewLength: result.recoveredPreview.length,
            status: options.apply ? 'updated' : 'recovered_dry_run',
            update: updateResult,
          },
          null,
          2,
        ),
      );
    }

    console.log(
      JSON.stringify(
        {
          summary: {
            candidates: candidates.length,
            recovered,
            updated,
            failed,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
