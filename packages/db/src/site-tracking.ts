import { jstNow } from './utils.js';

/**
 * 自社サイトの行動記録。
 *
 * 埋め込んだJSから送られてくる訪問と操作を貯める。友だちと突き合わせ
 * られたときだけ friend_id が埋まり、そこから先は「この人がどのページを
 * 見たか」が分かる。
 *
 * 個人情報を載せない。URLのクエリ文字列はここで落とす。
 */

export const SITE_EVENT_TYPES = [
  'page_view',
  'click',
  'scroll_depth',
  'custom',
  'purchase',
] as const;
export type SiteEventType = (typeof SITE_EVENT_TYPES)[number];

export interface SiteVisitor {
  id: string;
  friend_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  linked_at: string | null;
  linked_by: string | null;
}

export interface SiteEvent {
  id: string;
  visitor_id: string;
  friend_id: string | null;
  event_type: string;
  path: string | null;
  label: string | null;
  value_num: number | null;
  referrer: string | null;
  occurred_at: string;
}

/**
 * URLから記録してよい部分だけを取り出す。
 *
 * クエリ文字列を丸ごと落とす。?email=... や ?token=... が入る事故は
 * 「たまに起きる」ではなく「必ず起きる」ので、通す判断はしない。
 * ハッシュ（#以降）も同じ理由で落とす。
 *
 * 長さも切る。極端に長いパスは、たいてい何かが埋め込まれている。
 */
export function sanitizePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let path = raw;
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  const h = path.indexOf('#');
  if (h >= 0) path = path.slice(0, h);
  // 絶対URLで来た場合はパスだけにする。ホスト名は site_visitors 側の話。
  const schemeMatch = /^https?:\/\/[^/]+(\/.*)?$/.exec(path);
  if (schemeMatch) path = schemeMatch[1] ?? '/';
  if (path === '') return '/';
  return path.slice(0, 512);
}

/** リファラも同じ扱い。出どころは知りたいが、中身のパラメータは要らない。 */
export function sanitizeReferrer(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const q = raw.indexOf('?');
  const trimmed = q >= 0 ? raw.slice(0, q) : raw;
  return trimmed.slice(0, 512);
}

export async function getOrCreateVisitor(
  db: D1Database,
  visitorId: string,
): Promise<SiteVisitor> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO site_visitors (id, first_seen_at, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .bind(visitorId, now, now)
    .run();
  return (await db
    .prepare(`SELECT * FROM site_visitors WHERE id = ?`)
    .bind(visitorId)
    .first<SiteVisitor>())!;
}

/**
 * 訪問者を友だちに結びつける。
 *
 * 一度結びついたら上書きしない。同じ端末を家族で使う場合など、
 * 後から別の人に付け替わると過去の行動まで別人のものになる。
 */
export async function linkVisitorToFriend(
  db: D1Database,
  visitorId: string,
  friendId: string,
  linkedBy: 'entry_route' | 'liff' | 'form' | 'manual',
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE site_visitors
          SET friend_id = ?, linked_at = ?, linked_by = ?
        WHERE id = ? AND friend_id IS NULL`,
    )
    .bind(friendId, jstNow(), linkedBy, visitorId)
    .run();
  const linked = (result.meta?.changes ?? 0) > 0;
  if (linked) {
    // 結びつく前に貯めた行動も、その人のものとして見えるようにする。
    await db
      .prepare(`UPDATE site_events SET friend_id = ? WHERE visitor_id = ? AND friend_id IS NULL`)
      .bind(friendId, visitorId)
      .run();
  }
  return linked;
}

export async function recordSiteEvent(
  db: D1Database,
  input: {
    visitorId: string;
    eventType: SiteEventType;
    path?: unknown;
    label?: string | null;
    valueNum?: number | null;
    referrer?: unknown;
  },
): Promise<void> {
  const visitor = await getOrCreateVisitor(db, input.visitorId);
  await db
    .prepare(
      `INSERT INTO site_events
         (id, visitor_id, friend_id, event_type, path, label, value_num, referrer, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.visitorId,
      visitor.friend_id,
      input.eventType,
      sanitizePath(input.path),
      input.label ? String(input.label).slice(0, 200) : null,
      input.valueNum ?? null,
      sanitizeReferrer(input.referrer),
      jstNow(),
    )
    .run();
}

/** ページ別の閲覧数。多い順。 */
export async function getPageViewSummary(
  db: D1Database,
  opts: { from: string; to: string; limit?: number },
): Promise<Array<{ path: string; views: number; visitors: number }>> {
  const result = await db
    .prepare(
      `SELECT path,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_id) AS visitors
         FROM site_events
        WHERE event_type = 'page_view' AND path IS NOT NULL
          AND occurred_at >= ? AND occurred_at <= ?
        GROUP BY path
        ORDER BY views DESC
        LIMIT ?`,
    )
    .bind(opts.from, opts.to, opts.limit ?? 50)
    .all<{ path: string; views: number; visitors: number }>();
  return result.results;
}

/** 1人の行動履歴。友だち詳細に出す。 */
export async function getFriendSiteEvents(
  db: D1Database,
  friendId: string,
  limit = 100,
): Promise<SiteEvent[]> {
  const result = await db
    .prepare(
      `SELECT * FROM site_events WHERE friend_id = ? ORDER BY occurred_at DESC LIMIT ?`,
    )
    .bind(friendId, limit)
    .all<SiteEvent>();
  return result.results;
}
