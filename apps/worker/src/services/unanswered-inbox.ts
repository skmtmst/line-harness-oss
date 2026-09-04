const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * 未対応判定の正本は chats.last_customer_message_at / last_operator_message_at。
 *
 * Webhook は自動応答に当たらなかった受信だけを last_customer_message_at へ保存し、
 * 手動返信は last_operator_message_at へ保存する。したがって messages_log 全体を
 * Worker へ読み出して判定し直す必要はない。本文と種別は、ページに入った友だちの
 * 最新対象メッセージだけを複合索引で取得する。
 */

export interface UnansweredRow {
  friendId: string;
  displayName: string | null;
  pictureUrl: string | null;
  accountId: string | null;
  accountName: string;
  lastIncomingAt: string;
  lastManualAt: string | null;
  lastMachineAt: string | null;
  lastIncomingType: string;
  lastIncomingContent: string;
}

export interface UnansweredInboxResult {
  total: number;
  page: number;
  pageSize: number;
  rows: UnansweredRow[];
}

export interface UnansweredCount {
  total: number;
  byAccount: Array<{ accountId: string; accountName: string; count: number }>;
  oldestWaitMinutes: number | null;
}

export interface UnansweredInboxOptions {
  q?: string;
  account?: string;
  minWaitMinutes?: number;
  page?: number;
  pageSize?: number;
  /** chats API から使う対応状態・担当者の追加絞り込み。 */
  status?: string;
  operatorId?: string;
  /** Restrict output to accounts visible to the authenticated caller. */
  allowedAccountIds: readonly string[];
  /** Include legacy friends whose account assignment is missing. */
  canSeeUnassigned: boolean;
}

interface RawUnansweredRow {
  friend_id: string;
  display_name: string | null;
  picture_url: string | null;
  line_account_id: string | null;
  account_name: string;
  last_incoming: string;
  last_manual: string | null;
  last_machine: string | null;
  last_incoming_type: string | null;
  last_incoming_content: string | null;
}

interface CountRow {
  total: number;
}

function accountScopeSql(opts: Pick<UnansweredInboxOptions, 'allowedAccountIds' | 'canSeeUnassigned'>): {
  sql: string;
  bindings: unknown[];
} {
  const accountJson = JSON.stringify([...new Set(opts.allowedAccountIds)]);
  if (opts.allowedAccountIds.length > 0 && opts.canSeeUnassigned) {
    return {
      sql: `(f.line_account_id IN (SELECT value FROM json_each(?)) OR f.line_account_id IS NULL)`,
      bindings: [accountJson],
    };
  }
  if (opts.allowedAccountIds.length > 0) {
    return {
      sql: `f.line_account_id IN (SELECT value FROM json_each(?))`,
      bindings: [accountJson],
    };
  }
  if (opts.canSeeUnassigned) return { sql: 'f.line_account_id IS NULL', bindings: [] };
  return { sql: '0 = 1', bindings: [] };
}

function escapedLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function queryFilters(opts: UnansweredInboxOptions, includeSearch: boolean): {
  sql: string;
  bindings: unknown[];
} {
  const scope = accountScopeSql(opts);
  const conditions = [
    scope.sql,
    'f.is_following = 1',
    '(la.id IS NULL OR la.is_active = 1)',
    `c.status != 'resolved'`,
    'c.last_customer_message_at IS NOT NULL',
    '(c.last_operator_message_at IS NULL OR julianday(c.last_operator_message_at) < julianday(c.last_customer_message_at))',
  ];
  const bindings = [...scope.bindings];

  if (opts.account) {
    conditions.push('f.line_account_id = ?');
    bindings.push(opts.account);
  }
  if (opts.status) {
    conditions.push('c.status = ?');
    bindings.push(opts.status);
  }
  if (opts.operatorId) {
    conditions.push('c.operator_id = ?');
    bindings.push(opts.operatorId);
  }
  if (opts.minWaitMinutes && opts.minWaitMinutes > 0) {
    conditions.push('julianday(c.last_customer_message_at) <= julianday(?)');
    bindings.push(new Date(Date.now() - opts.minWaitMinutes * 60_000).toISOString());
  }
  if (includeSearch && opts.q?.trim()) {
    conditions.push(`(
      f.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR incoming.content LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
    const like = escapedLike(opts.q.trim());
    bindings.push(like, like);
  }

  return { sql: conditions.join('\n AND '), bindings };
}

const PREVIEW_JOIN_SQL = `
  LEFT JOIN messages_log incoming ON incoming.id = (
    SELECT mi.id
      FROM messages_log mi
     WHERE mi.friend_id = c.friend_id
       AND mi.direction = 'incoming'
       AND (mi.source IS NULL OR mi.source != 'postback')
       AND mi.created_at <= c.last_customer_message_at
     ORDER BY mi.created_at DESC, mi.id DESC
     LIMIT 1
  )`;

export async function computeUnansweredInbox(
  db: D1Database,
  opts: UnansweredInboxOptions,
): Promise<UnansweredInboxResult> {
  const page = Math.max(1, Number.isFinite(opts.page) ? Math.trunc(opts.page ?? 1) : 1);
  const requestedPageSize = Number.isFinite(opts.pageSize)
    ? Math.trunc(opts.pageSize ?? DEFAULT_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedPageSize));
  const offset = (page - 1) * pageSize;
  const hasSearch = Boolean(opts.q?.trim());
  const filters = queryFilters(opts, hasSearch);

  const countSql = `
    SELECT COUNT(*) AS total
      FROM chats AS c INDEXED BY idx_chats_unanswered_page
      INNER JOIN friends f ON f.id = c.friend_id
      LEFT JOIN line_accounts la ON la.id = f.line_account_id
      ${hasSearch ? PREVIEW_JOIN_SQL : ''}
     WHERE ${filters.sql}`;

  const rowsSql = `
    SELECT
      c.friend_id,
      f.display_name,
      f.picture_url,
      f.line_account_id,
      COALESCE(la.name, '(未分類)') AS account_name,
      c.last_customer_message_at AS last_incoming,
      c.last_operator_message_at AS last_manual,
      (
        SELECT MAX(machine.created_at)
          FROM messages_log machine
         WHERE machine.friend_id = c.friend_id
           AND machine.direction = 'outgoing'
           AND machine.source IN ('auto_reply','automation','automation_backfill','scenario','broadcast')
      ) AS last_machine,
      incoming.message_type AS last_incoming_type,
      incoming.content AS last_incoming_content
      FROM chats AS c INDEXED BY idx_chats_unanswered_page
      INNER JOIN friends f ON f.id = c.friend_id
      LEFT JOIN line_accounts la ON la.id = f.line_account_id
      ${PREVIEW_JOIN_SQL}
     WHERE ${filters.sql}
     ORDER BY c.last_customer_message_at DESC, c.friend_id DESC
     LIMIT ? OFFSET ?`;

  const [countResult, rowsResult] = await Promise.all([
    db.prepare(countSql).bind(...filters.bindings).first<CountRow>(),
    db.prepare(rowsSql).bind(...filters.bindings, pageSize, offset).all<RawUnansweredRow>(),
  ]);

  return {
    total: Number(countResult?.total ?? 0),
    page,
    pageSize,
    rows: (rowsResult.results ?? []).map((row) => ({
      friendId: row.friend_id,
      displayName: row.display_name,
      pictureUrl: row.picture_url,
      accountId: row.line_account_id,
      accountName: row.account_name,
      lastIncomingAt: row.last_incoming,
      lastManualAt: row.last_manual,
      lastMachineAt: row.last_machine,
      lastIncomingType: row.last_incoming_type ?? 'text',
      lastIncomingContent: row.last_incoming_content ?? '',
    })),
  };
}

interface RawCountRow {
  line_account_id: string | null;
  account_name: string;
  count: number;
  oldest_at: string | null;
}

export async function countUnanswered(
  db: D1Database,
  opts: Pick<UnansweredInboxOptions, 'allowedAccountIds' | 'canSeeUnassigned'>,
): Promise<UnansweredCount> {
  const scope = accountScopeSql(opts);
  const result = await db.prepare(
    `SELECT f.line_account_id,
            COALESCE(la.name, '(未分類)') AS account_name,
            COUNT(*) AS count,
            MIN(c.last_customer_message_at) AS oldest_at
       FROM chats AS c INDEXED BY idx_chats_unanswered_page
       INNER JOIN friends f ON f.id = c.friend_id
       LEFT JOIN line_accounts la ON la.id = f.line_account_id
      WHERE ${scope.sql}
        AND f.is_following = 1
        AND (la.id IS NULL OR la.is_active = 1)
        AND c.status != 'resolved'
        AND c.last_customer_message_at IS NOT NULL
        AND (c.last_operator_message_at IS NULL
             OR julianday(c.last_operator_message_at) < julianday(c.last_customer_message_at))
      GROUP BY f.line_account_id, COALESCE(la.name, '(未分類)')
      ORDER BY count DESC, account_name ASC`,
  ).bind(...scope.bindings).all<RawCountRow>();

  let oldest: string | null = null;
  let total = 0;
  const byAccount = (result.results ?? []).map((row) => {
    total += Number(row.count ?? 0);
    if (row.oldest_at && (oldest === null || row.oldest_at < oldest)) oldest = row.oldest_at;
    return {
      accountId: row.line_account_id ?? '__unassigned__',
      accountName: row.account_name,
      count: Number(row.count ?? 0),
    };
  });

  return {
    total,
    byAccount,
    oldestWaitMinutes: oldest === null
      ? null
      : Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 60_000)),
  };
}
