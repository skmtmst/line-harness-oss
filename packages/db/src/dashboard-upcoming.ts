/**
 * M (今後の予定): 7日分の予定の読み取り専用まとめ。
 *
 * 新しい表は作らない。06の予約配信・07のリマインダ予定・27の未来の予約を
 * 時刻順に束ねて返すだけ。書き込みは一切しない。各機能の画面へのつなぎは
 * 一覧へのリンクに留め、絞り込み条件の推測はしない。
 */

/** 予定の種類。見出しの札と行き先を決める。 */
export type UpcomingKind = 'broadcast' | 'reminder' | 'booking';

export interface UpcomingItem {
  kind: UpcomingKind;
  id: string;
  /** 画面に出す1行。相手の名前が分かれば含める。 */
  title: string;
  /** 始まる時刻(ISO 文字列)。取得元の値をそのまま返す。 */
  startsAt: string;
  /** 各機能の一覧への行き先。 */
  href: string;
}

export interface DashboardUpcoming {
  items: UpcomingItem[];
  /** 束ねた時刻。 */
  asOf: string;
  /** 何日分を束ねたか。 */
  rangeDays: number;
}

/** 一覧に並べる上限。7日分でも行が増えすぎないようにする。 */
export const UPCOMING_ITEM_LIMIT = 50;

function toTitle(name: string | null, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * 未来の予定を3つの機能から束ねる。`now` と `now + days` の間だけを読む。
 *
 * 予約配信は選択中アカウントの `scheduled` だけ。複数アカウント配信の
 * `account_ids` 側は含めない(別アカウントの予定が混ざらないようにする)。
 * リマインダは受信中の友だち(`active`)の `target_date` を読む。
 * 予約は確定・承認待ちの `starts_at` を読む。変更・取消は含めない。
 */
export async function getDashboardUpcoming(
  db: D1Database,
  input: { lineAccountId: string; now: string; days: number },
): Promise<DashboardUpcoming> {
  const days = Math.min(Math.max(Math.floor(input.days), 1), 31);
  const until = new Date(Date.parse(input.now) + days * 86_400_000).toISOString();
  const items: UpcomingItem[] = [];

  const broadcasts = await db.prepare(`
    SELECT id, title, scheduled_at FROM broadcasts
     WHERE line_account_id = ?
       AND status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at >= ? AND scheduled_at <= ?
     ORDER BY scheduled_at ASC
     LIMIT ${UPCOMING_ITEM_LIMIT}
  `).bind(input.lineAccountId, input.now, until).all<{
    id: string; title: string; scheduled_at: string;
  }>();
  for (const row of broadcasts.results) {
    items.push({
      kind: 'broadcast',
      id: row.id,
      title: toTitle(row.title, '予約配信'),
      startsAt: row.scheduled_at,
      href: '/broadcasts',
    });
  }

  const reminders = await db.prepare(`
    SELECT fr.id AS id, fr.target_date AS target_date,
           r.name AS reminder_name, f.display_name AS friend_name
      FROM friend_reminders fr
      JOIN friends f ON f.id = fr.friend_id AND f.line_account_id = ?
      JOIN reminders r ON r.id = fr.reminder_id AND r.is_active = 1
     WHERE fr.status = 'active'
       AND fr.target_date >= ? AND fr.target_date <= ?
     ORDER BY fr.target_date ASC
     LIMIT ${UPCOMING_ITEM_LIMIT}
  `).bind(input.lineAccountId, input.now, until).all<{
    id: string; target_date: string; reminder_name: string | null; friend_name: string | null;
  }>();
  for (const row of reminders.results) {
    const who = row.friend_name?.trim();
    items.push({
      kind: 'reminder',
      id: row.id,
      title: who ? `${toTitle(row.reminder_name, 'リマインダー')}（${who}）` : toTitle(row.reminder_name, 'リマインダー'),
      startsAt: row.target_date,
      href: '/reminders',
    });
  }

  const bookings = await db.prepare(`
    SELECT b.id AS id, b.starts_at AS starts_at,
           m.name AS menu_name, f.display_name AS friend_name
      FROM bookings b
      LEFT JOIN menus m ON m.id = b.menu_id
      LEFT JOIN friends f ON f.id = b.friend_id
     WHERE b.line_account_id = ?
       AND b.status IN ('requested', 'confirmed')
       AND b.starts_at >= ? AND b.starts_at <= ?
     ORDER BY b.starts_at ASC
     LIMIT ${UPCOMING_ITEM_LIMIT}
  `).bind(input.lineAccountId, input.now, until).all<{
    id: string; starts_at: string; menu_name: string | null; friend_name: string | null;
  }>();
  for (const row of bookings.results) {
    const menu = toTitle(row.menu_name, '予約');
    const who = row.friend_name?.trim();
    items.push({
      kind: 'booking',
      id: row.id,
      title: who ? `${menu}（${who}）` : menu,
      startsAt: row.starts_at,
      href: '/booking/bookings?view=list',
    });
  }

  items.sort((left, right) => left.startsAt < right.startsAt ? -1 : left.startsAt > right.startsAt ? 1 : 0);
  return { items: items.slice(0, UPCOMING_ITEM_LIMIT), asOf: input.now, rangeDays: days };
}
