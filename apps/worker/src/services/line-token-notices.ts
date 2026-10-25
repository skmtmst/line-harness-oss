import type {
  LineTokenNoticeEventType,
  LineTokenNoticeMetadata,
  LineTokenRefreshFailureReason,
} from '@line-crm/shared';

/** 取り替えの処理と同じ窓。残りがこれ未満になると cron ごとに取り替える。 */
export const LINE_TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;
const REENTER_HINT = 'LINE Developers でチャネルシークレットを確かめて、アカウントの設定で入れ直してください。';

type Notice = { eventType: LineTokenNoticeEventType; title: string; body: string };

/**
 * 取り替えに失敗した時に書く知らせを決める。自動で直る見込みのある間は何も書かない。
 * 期限の無い鍵（expiresAt が空）には「あと何日」を作らない。
 */
export function lineTokenNoticeFor(input: {
  expiresAt: string | null;
  reason: LineTokenRefreshFailureReason;
  now: number;
}): Notice | null {
  const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  const known = Number.isFinite(expiresAt);
  if (known && expiresAt <= input.now) {
    return {
      eventType: 'line_token_expired',
      title: 'LINEの鍵の期限が切れています',
      body: `配信と返信が止まっています。${input.reason === 'credentials' ? REENTER_HINT : 'LINEの接続の設定で鍵を更新してください。'}`,
    };
  }
  if (input.reason === 'credentials') {
    return {
      eventType: 'line_token_refresh_failed',
      title: 'LINEの鍵を自動で取り替えられませんでした',
      body: REENTER_HINT,
    };
  }
  if (known && expiresAt - input.now < LINE_TOKEN_REFRESH_WINDOW_MS) {
    const daysLeft = Math.floor((expiresAt - input.now) / DAY_MS);
    return {
      eventType: 'line_token_expiring',
      title: daysLeft === 0 ? 'LINEの鍵が今日切れます' : `LINEの鍵があと${daysLeft}日で切れます`,
      body: '自動の取り替えがうまくいっていません。LINEの接続の設定で鍵を更新してください。',
    };
  }
  return null;
}

/**
 * 取り替えの失敗を、そのアカウントの知らせとして残す。
 * 5分ごとの cron で重ねないよう、同じアカウント・同じ種類・同じ期限では 1 回だけ書く。
 * 書いた時は true。
 */
export async function recordLineTokenRefreshFailure(
  db: D1Database,
  account: { id: string; token_expires_at: string | null },
  reason: LineTokenRefreshFailureReason,
  now = Date.now(),
): Promise<boolean> {
  const notice = lineTokenNoticeFor({ expiresAt: account.token_expires_at, reason, now });
  if (!notice) return false;
  const expiresAt = account.token_expires_at ?? null;
  const parsed = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const metadata: LineTokenNoticeMetadata = {
    expiresAt,
    daysLeft: Number.isFinite(parsed) ? Math.floor((parsed - now) / DAY_MS) : null,
    reason,
    failedAt: new Date(now).toISOString(),
  };
  const result = await db.prepare(
    `INSERT INTO notifications (id, event_type, title, body, channel, status, category, metadata, line_account_id)
     SELECT ?, ?, ?, ?, 'dashboard', 'sent', 'error', ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications
         WHERE line_account_id = ? AND event_type = ?
           AND json_extract(metadata, '$.expiresAt') IS ?
      )`,
  ).bind(
    crypto.randomUUID(), notice.eventType, notice.title, notice.body, JSON.stringify(metadata), account.id,
    account.id, notice.eventType, expiresAt,
  ).run();
  return Number(result.meta.changes ?? 0) > 0;
}

/** 今の鍵（同じ期限）について、取り替えの失敗が残っているか。稼働確認の注意に使う。 */
export async function hasLineTokenRefreshFailure(
  db: D1Database,
  lineAccountId: string,
  expiresAt: string | null,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS found FROM notifications
      WHERE line_account_id = ?
        AND event_type IN ('line_token_expiring', 'line_token_refresh_failed')
        AND json_extract(metadata, '$.expiresAt') IS ?
      LIMIT 1`,
  ).bind(lineAccountId, expiresAt).first<{ found: number }>();
  return Boolean(row);
}
