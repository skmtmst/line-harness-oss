/**
 * 予約配信を送る直前に、残りの送信枠を確かめる。
 *
 * 設計 `Bw0zt`（6-1-E 送信設定）の注意書きは
 * 「**予約時刻の直前に対象人数と送信枠を再確認します。**」と約束している。
 * 対象人数は `processSegmentSend` が送信時に数え直していたが、
 * **送信枠は誰も見ていなかった。**
 *
 * 予約したあとに枠を使い切ると、**予約は実行されるが途中で失敗する。**
 * 送った人と送れなかった人が混ざり、運用者は結果を見るまで気づけない。
 * 足りないと分かった時点で送らないほうが、あとから追いかけやすい。
 *
 * **取れないときは止めない。** LINE の口が落ちているだけで予約を潰すと、
 * 送れるはずの配信が届かなくなる。分からないものは分からないと記録して
 * 通す（`state: 'unknown'`）。
 */

export type QuotaCheck =
  | { state: 'ok'; limit: number; used: number; remaining: number }
  | { state: 'short'; limit: number; used: number; remaining: number; shortfall: number }
  /** 上限が無い（無制限）か、口が答えなかった。**止める理由にしない。** */
  | { state: 'unknown'; reason: string };

type QuotaFetch = {
  /** `GET /v2/bot/message/quota` */
  limit: number | null;
  /** `GET /v2/bot/message/quota/consumption` */
  used: number | null;
};

/**
 * 残りの枠と、これから送る通数を突き合わせる。
 *
 * **1人1通で数える。** 吹き出しを複数持つ配信でも、LINE の集計は
 * 「送った人数」ではなく「送ったメッセージ数」なので、呼ぶ側が
 * 通数を渡す。
 */
export function evaluateQuota(fetched: QuotaFetch, planned: number): QuotaCheck {
  if (fetched.limit === null) {
    return { state: 'unknown', reason: '送信枠の上限を取得できませんでした' };
  }
  if (fetched.used === null) {
    return { state: 'unknown', reason: '今月の送信数を取得できませんでした' };
  }
  const remaining = Math.max(0, fetched.limit - fetched.used);
  if (planned > remaining) {
    return {
      state: 'short',
      limit: fetched.limit,
      used: fetched.used,
      remaining,
      shortfall: planned - remaining,
    };
  }
  return { state: 'ok', limit: fetched.limit, used: fetched.used, remaining };
}

/**
 * 足りないときに運用者へ出す文。
 *
 * **内部の語も番号も出さない。** 何通足りないか、次に何をすればよいかを書く。
 */
export function shortfallMessage(check: Extract<QuotaCheck, { state: 'short' }>, planned: number): string {
  return (
    `送ろうとした ${planned.toLocaleString('ja-JP')}通 に対して、`
    + `今月の残りが ${check.remaining.toLocaleString('ja-JP')}通 しかありません`
    + `（${check.shortfall.toLocaleString('ja-JP')}通 足りません）。`
    + 'この配信は送らずに下書きへ戻しました。'
    + '送る相手を減らすか、来月に予約し直してください。'
  )
}

/** LINE から上限と使用数を読む。**落ちても投げない**（`null` にして呼ぶ側で判断する）。 */
export async function fetchQuota(channelAccessToken: string): Promise<QuotaFetch> {
  const headers = { Authorization: `Bearer ${channelAccessToken}` };
  const read = async (path: string, pick: (json: Record<string, unknown>) => number | null) => {
    try {
      const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return pick((await res.json()) as Record<string, unknown>);
    } catch {
      return null;
    }
  };
  const [limit, used] = await Promise.all([
    read('quota', (json) =>
      json.type === 'limited' && typeof json.value === 'number' ? json.value : null,
    ),
    read('quota/consumption', (json) =>
      typeof json.totalUsage === 'number' ? json.totalUsage : null,
    ),
  ]);
  return { limit, used };
}

/*
 * N-062 REJECT対応: アカウント単位の送信枠の予約台帳。
 * 配信単位の claim は行を排他するが、アカウント残枠を別配信間で排他しない。
 * 残枠1を読んだ2配信が同時に進む TOCTOU を止めるため、送る前に枠を予約する。
 * 置き場所は既存の `account_settings` の1行（migration なし）。
 * 値は [{broadcastId, planned, reservedAt}] の JSON。CAS（値の一致条件つき
 * UPDATE）で書き換え、競合したら読み直して最大3回まで試す。
 * 予約は送信の成否に関わらず送り終わったら外す。壊れた値は空とみなす。
 * 30分を超えた予約は置き去りとみなして数えない（外す）。
 */
const QUOTA_RESERVATION_KEY = 'broadcast_quota_reservations';
const QUOTA_RESERVATION_TTL_MS = 30 * 60 * 1000;
const QUOTA_RESERVATION_RETRIES = 3;

type QuotaReservation = { broadcastId: string; planned: number; reservedAt: number };

function parseQuotaReservations(raw: unknown): QuotaReservation[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is QuotaReservation =>
        typeof entry === 'object' && entry !== null &&
        typeof (entry as QuotaReservation).broadcastId === 'string' &&
        typeof (entry as QuotaReservation).planned === 'number' &&
        typeof (entry as QuotaReservation).reservedAt === 'number',
    );
  } catch {
    return [];
  }
}

/** 予約を試みる。枠に入れば true、残枠超え・CAS競合の連続失敗なら false（送らない）。 */
export async function tryReserveQuotaSlot(
  db: D1Database,
  accountId: string,
  broadcastId: string,
  planned: number,
  used: number,
  limit: number,
): Promise<boolean> {
  const now = Date.now();
  for (let attempt = 0; attempt < QUOTA_RESERVATION_RETRIES; attempt++) {
    const row = await db.prepare(
      `SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`,
    ).bind(accountId, QUOTA_RESERVATION_KEY).first<{ value: string }>();
    const active = parseQuotaReservations(row?.value).filter(
      (entry) => now - entry.reservedAt < QUOTA_RESERVATION_TTL_MS,
    );
    const reserved = active.reduce((sum, entry) => sum + entry.planned, 0);
    if (used + reserved + planned > limit) return false;
    const next = [
      ...active.filter((entry) => entry.broadcastId !== broadcastId),
      { broadcastId, planned, reservedAt: now },
    ];
    const encoded = JSON.stringify(next);
    if (!row) {
      try {
        await db.prepare(
          `INSERT INTO account_settings (id, line_account_id, key, value) VALUES (?, ?, ?, ?)`,
        ).bind(`quota-reservations-${accountId}`, accountId, QUOTA_RESERVATION_KEY, encoded).run();
        return true;
      } catch {
        continue;
      }
    }
    const updated = await db.prepare(
      `UPDATE account_settings SET value = ?, updated_at = ? WHERE line_account_id = ? AND key = ? AND value = ?`,
    ).bind(encoded, new Date(now).toISOString(), accountId, QUOTA_RESERVATION_KEY, row.value).run();
    if ((updated.meta.changes ?? 0) > 0) return true;
  }
  return false;
}

/** 予約を外す。行がなくても壊れていても成功扱い（送る側を止めない）。 */
export async function releaseQuotaSlot(
  db: D1Database,
  accountId: string,
  broadcastId: string,
): Promise<void> {
  try {
    const now = Date.now();
    for (let attempt = 0; attempt < QUOTA_RESERVATION_RETRIES; attempt++) {
      const row = await db.prepare(
        `SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`,
      ).bind(accountId, QUOTA_RESERVATION_KEY).first<{ value: string }>();
      if (!row) return;
      const next = parseQuotaReservations(row.value).filter(
        (entry) => entry.broadcastId !== broadcastId && now - entry.reservedAt < QUOTA_RESERVATION_TTL_MS,
      );
      const encoded = JSON.stringify(next);
      const updated = await db.prepare(
        `UPDATE account_settings SET value = ?, updated_at = ? WHERE line_account_id = ? AND key = ? AND value = ?`,
      ).bind(encoded, new Date(now).toISOString(), accountId, QUOTA_RESERVATION_KEY, row.value).run();
      if ((updated.meta.changes ?? 0) > 0) return;
    }
  } catch {
    // 予約行の掃除の失敗で送信結果を変えない。
  }
}
