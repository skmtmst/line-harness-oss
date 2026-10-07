import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import type {
  ConversationCursor,
  ConversationSearchHit,
} from '@line-crm/shared';
import { requirePermission } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
export const chatMessages = new Hono<Env>();
type Row = {
  id: string;
  content: string;
  created_at: string;
  line_event_at: string | null;
  at: string;
  direction: 'incoming' | 'outgoing';
  message_type: string;
  unsent_at: string | null;
};
const visible = "(delivery_type IS NULL OR delivery_type!='test')";
const select =
  "id,CASE WHEN unsent_at IS NULL THEN content ELSE '' END content,created_at,line_event_at,COALESCE(line_event_at,created_at) at,direction,message_type,unsent_at";
const point = (r: Row): ConversationCursor => ({ at: r.at, id: r.id });
export const normalizeConversationSearch = (s: string) =>
  s.normalize('NFKC').toLowerCase();
async function authorize(c: Context<Env>): Promise<string | Response> {
  const id = c.req.param('friendId')!;
  const friend = await c.env.DB.prepare(
    'SELECT line_account_id FROM friends WHERE id=?',
  )
    .bind(id)
    .first<{ line_account_id: string | null }>();
  if (
    !friend ||
    !(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [
      friend.line_account_id,
    ]))
  )
    return c.json({ success: false, error: 'not_found' }, 404);
  c.header('Cache-Control', 'no-store');
  return id;
}
const excerpt = (text: string, needle?: string) => {
  const normalized = normalizeConversationSearch(text),
    chars = Array.from(normalized),
    unitHit = needle ? normalized.indexOf(needle) : -1;
  const hit =
    unitHit < 0 ? -1 : Array.from(normalized.slice(0, unitHit)).length;
  // 検索語のまわりを切り出す。絵文字・濁点の変換で元文字の位置が変わるので正規化した抜粋を返す。
  const start = Math.max(0, hit - 50);
  return (
    (start ? '…' : '') +
    chars.slice(start, start + 160).join('') +
    (chars.length > start + 160 ? '…' : '')
  );
};
chatMessages.use('/api/chats/:friendId/messages*', requirePermission('/chats'));
chatMessages.get('/api/chats/:friendId/messages/search', async (c) => {
  const friend = await authorize(c);
  if (friend instanceof Response) return friend;
  const q = c.req.query('q')?.trim() ?? '',
    needle = normalizeConversationSearch(q);
  const limit = Number(c.req.query('limit') ?? 30),
    offset = Number(c.req.query('offset') ?? 0);
  if (
    !q ||
    Array.from(q).length > 200 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    return c.json({ success: false, error: 'invalid_search' }, 400);
  const hits: ConversationSearchHit[] = [];
  let total = 0,
    previous: Row | null = null,
    cursor: ConversationCursor | null = null,
    pending: ConversationSearchHit | null = null;
  // D1にはNFKCがないため、安定した順序で500件ずつ読み、JSで表記をそろえて数える。LIMITによる件数の取りこぼしをしない。
  for (;;) {
    const args: unknown[] = [friend];
    if (cursor) args.push(cursor.at, cursor.at, cursor.id);
    const rows = (
      await c.env.DB.prepare(
        `SELECT ${select} FROM messages_log WHERE friend_id=? AND ${visible} ${cursor ? 'AND (COALESCE(line_event_at,created_at)>? OR (COALESCE(line_event_at,created_at)=? AND id>?))' : ''} ORDER BY at,id LIMIT 500`,
      )
        .bind(...args)
        .all<Row>()
    ).results;
    if (!rows.length) break;
    for (const row of rows) {
      if (pending) {
        pending.after = { id: row.id, excerpt: excerpt(row.content) };
        pending = null;
      }
      if (
        !row.unsent_at &&
        normalizeConversationSearch(row.content).includes(needle)
      ) {
        if (total >= offset && hits.length < limit) {
          const hit: ConversationSearchHit = {
            id: row.id,
            at: row.at,
            excerpt: excerpt(row.content, needle),
            before: previous
              ? { id: previous.id, excerpt: excerpt(previous.content) }
              : null,
            after: null,
            cursor: point(row),
          };
          hits.push(hit);
          pending = hit;
        }
        total++;
      }
      previous = row;
    }
    cursor = point(rows[rows.length - 1]!);
    if (rows.length < 500) break;
  }
  return c.json({
    success: true,
    data: {
      total,
      hits,
      nextOffset: offset + hits.length < total ? offset + hits.length : null,
    },
  });
});
chatMessages.get('/api/chats/:friendId/messages', async (c) => {
  const friend = await authorize(c);
  if (friend instanceof Response) return friend;
  const limit = Number(c.req.query('limit') ?? 50),
    at = c.req.query('cursorAt'),
    id = c.req.query('cursorId'),
    direction = c.req.query('direction') ?? 'before';
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    Boolean(at) !== Boolean(id) ||
    (at && !Number.isFinite(Date.parse(at))) ||
    !['before', 'after', 'around'].includes(direction) ||
    (direction === 'around' && !id)
  )
    return c.json({ success: false, error: 'invalid_cursor' }, 400);
  if (
    id &&
    !(await c.env.DB.prepare(
      `SELECT id FROM messages_log WHERE friend_id=? AND id=? AND COALESCE(line_event_at,created_at)=? AND ${visible}`,
    )
      .bind(friend, id, at)
      .first())
  )
    return c.json({ success: false, error: 'not_found' }, 404);
  const total = (await c.env.DB.prepare(
    `SELECT COUNT(*) total FROM messages_log WHERE friend_id=? AND ${visible}`,
  )
    .bind(friend)
    .first<{ total: number }>())!.total;
  async function side(after: boolean, count: number) {
    const op = after ? '>' : '<',
      args: unknown[] = [friend];
    if (id) args.push(at, at, id);
    args.push(count + 1);
    const rows = (
      await c.env.DB.prepare(
        `SELECT ${select} FROM messages_log WHERE friend_id=? AND ${visible} ${id ? `AND (COALESCE(line_event_at,created_at)${op}? OR (COALESCE(line_event_at,created_at)=? AND id${op}?))` : ''} ORDER BY at ${after ? 'ASC' : 'DESC'},id ${after ? 'ASC' : 'DESC'} LIMIT ?`,
      )
        .bind(...args)
        .all<Row>()
    ).results;
    const more = rows.length > count;
    if (more) rows.pop();
    return { rows: after ? rows : rows.reverse(), more };
  }
  let rows: Row[],
    beforeMore = false,
    afterMore = false;
  if (direction === 'around') {
    const [before, after, anchor] = await Promise.all([
      side(false, Math.ceil((limit - 1) / 2)),
      side(true, Math.floor((limit - 1) / 2)),
      c.env.DB.prepare(
        `SELECT ${select} FROM messages_log WHERE friend_id=? AND id=? AND ${visible}`,
      )
        .bind(friend, id)
        .first<Row>(),
    ]);
    rows = [...before.rows, anchor!, ...after.rows];
    beforeMore = before.more;
    afterMore = after.more;
  } else {
    const result = await side(direction === 'after', limit);
    rows = result.rows;
    beforeMore = direction === 'before' && result.more;
    afterMore = direction === 'after' && result.more;
  }
  return c.json({
    success: true,
    data: {
      total,
      messages: rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        messageType: r.message_type,
        content: r.content,
        isUnsent: !!r.unsent_at,
        createdAt: r.created_at,
        eventAt: r.line_event_at,
      })),
      beforeCursor: beforeMore && rows.length ? point(rows[0]!) : null,
      afterCursor:
        afterMore && rows.length ? point(rows[rows.length - 1]!) : null,
    },
  });
});
