import { toJstString } from '@line-crm/db';

/**
 * PHOTO-06 (#1079): 採用写真のECポイント付与（nen_photo_reward_outbox）を
 * 外部ECへ届けて状態を進める消費側。
 *
 * 背景: outbox 行は採用時に pending で積まれるが、これまで処理する側が
 * 存在せず、全件が「手続き中」のまま止まっていた。ここでは
 *   - 採用直後・管理操作・cron の3入口から同じ deliver を呼ぶ
 *   - EC側は awardKey（provider_award_key）で冪等なので、再送・照合で
 *     二重付与にならない（EC成功・管理DB失敗も照合で synced に収束する）
 *   - 状態は pending / processing / synced / failed の4値のまま保ち、
 *     画面向けの区別（要対応・再試行可・恒久失敗）は派生状態で出す
 */

export type PhotoRewardOutboxRow = {
  id: string;
  photo_id: string;
  line_account_id: string;
  friend_id: string;
  customer_id: string;
  provider_award_key: string;
  policy_version: string;
  points: number;
  status: 'pending' | 'processing' | 'synced' | 'failed';
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EcPhotoPointClient = { baseUrl: string; secret: string };

/** 誕生日クーポン（index.ts cron）と同じ2変数から接続先を組み立てる。 */
export function ecPhotoPointClientFromEnv(env: {
  NEN_EC_BASE_URL?: string;
  ECCUBE_WEBHOOK_SECRET?: string;
}): EcPhotoPointClient | undefined {
  return env.NEN_EC_BASE_URL && env.ECCUBE_WEBHOOK_SECRET
    ? { baseUrl: env.NEN_EC_BASE_URL, secret: env.ECCUBE_WEBHOOK_SECRET }
    : undefined;
}

/** これ以上の自動再試行は打ち切る回数。以後は運用者の再試行だけが残る。 */
export const PHOTO_REWARD_MAX_ATTEMPTS = 8;
/** pending/processing のまま更新が止まって「要対応」と見なす時間。 */
export const PHOTO_REWARD_STALE_MS = 24 * 60 * 60 * 1000;
/** processing 取得のリース。これを超えた processing は回収対象。 */
const PHOTO_REWARD_CLAIM_LEASE_MS = 10 * 60 * 1000;
/** EC呼び出し1回あたりの上限。ハングでルート全体を止めない。 */
const EC_CALL_TIMEOUT_MS = 10_000;

/** 運用者がやり直しても直らない失敗の理由コード。 */
const PERMANENT_REASONS = new Set([
  'customer_unlinked',
  'invalid_award',
  'ec_auth_failed',
  'attempts_exhausted',
]);

export type PhotoRewardDisplayState =
  | 'pending'
  | 'stale'
  | 'synced'
  | 'failed_retryable'
  | 'failed_permanent';

/** 一覧・詳細で共通の運用向け状態。SQL側のCASEと同じ分岐にする。 */
export function photoRewardDisplayState(
  row: Pick<PhotoRewardOutboxRow, 'status' | 'last_error' | 'updated_at'>,
  now: Date,
): PhotoRewardDisplayState {
  if (row.status === 'synced') return 'synced';
  if (row.status === 'failed') {
    return row.last_error && PERMANENT_REASONS.has(row.last_error)
      ? 'failed_permanent'
      : 'failed_retryable';
  }
  const updatedMs = Date.parse(row.updated_at);
  if (Number.isFinite(updatedMs) && now.getTime() - updatedMs > PHOTO_REWARD_STALE_MS) {
    return 'stale';
  }
  return 'pending';
}

/** 失敗理由を運用者向けの日本語にそろえる（画面側の表示名の正本）。 */
export const PHOTO_REWARD_REASON_LABELS: Record<string, string> = {
  customer_unlinked: 'EC会員との連携が外れています',
  invalid_award: '付与内容がEC側で受け付けられませんでした',
  ec_auth_failed: 'ECとの接続設定（署名）が一致しません',
  daily_limit: '本日の付与上限に達しました',
  attempts_exhausted: '自動再試行の上限に達しました',
  ec_unavailable: 'ECへの接続に失敗しました',
  ec_rejected: 'EC側が付与を受け付けませんでした',
};

type EcAwardResponse = {
  success?: boolean;
  duplicate?: boolean;
  awardedPoints?: number;
  pointBalance?: number;
  error?: string;
};

/** EC-CUBE 側の `POST /line-harness/photo-points`（HMAC署名はクーポン発行と同じ）。 */
async function awardEcPhotoPoint(
  client: EcPhotoPointClient,
  input: { customerId: string; points: number; awardKey: string },
  fetcher: typeof fetch,
): Promise<{ status: number; body: EcAwardResponse }> {
  const body = JSON.stringify({
    customerId: Number(input.customerId),
    points: input.points,
    awardKey: input.awardKey,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(client.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const response = await fetcher(`${client.baseUrl.replace(/\/$/, '')}/line-harness/photo-points`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nen-Timestamp': timestamp,
      'X-Nen-Signature': `sha256=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(EC_CALL_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => ({})) as EcAwardResponse;
  return { status: response.status, body: json };
}

export type RewardDeliveryOutcome =
  | { kind: 'synced'; duplicate: boolean; pointBalance: number | null }
  | { kind: 'retry_later'; reason: string; nextAttemptAt: string }
  | { kind: 'permanent'; reason: string };

function backoffNextAttempt(now: Date, attemptCount: number, reason: string): string {
  if (reason === 'daily_limit') {
    // EC側の日次上限は暦日で数える。翌日の同時刻まで待つ。
    return toJstString(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  }
  const delayMs = Math.min(2 ** Math.max(0, attemptCount - 1) * 5 * 60 * 1000, 6 * 60 * 60 * 1000);
  return toJstString(new Date(now.getTime() + delayMs));
}

type ClassifiedEcResult =
  | { kind: 'synced'; duplicate: boolean; pointBalance: number | null }
  | { kind: 'retry_later'; reason: string }
  | { kind: 'permanent'; reason: string };

function classifyEcResult(status: number, body: EcAwardResponse): ClassifiedEcResult {
  if (status === 200 || status === 201) {
    if (body.success === true) {
      return {
        kind: 'synced',
        duplicate: body.duplicate === true,
        pointBalance: typeof body.pointBalance === 'number' ? body.pointBalance : null,
      };
    }
    // success:false を200で返す形。文言で再試行性を分ける。
    return /linked customer not found/i.test(body.error ?? '')
      ? { kind: 'permanent', reason: 'customer_unlinked' }
      : { kind: 'retry_later', reason: 'ec_rejected' };
  }
  if (status === 400 || status === 413) return { kind: 'permanent', reason: 'invalid_award' };
  if (status === 401 || status === 403) return { kind: 'permanent', reason: 'ec_auth_failed' };
  if (status === 404) return { kind: 'permanent', reason: 'customer_unlinked' };
  if (status === 409) return { kind: 'retry_later', reason: 'daily_limit' };
  return { kind: 'retry_later', reason: 'ec_unavailable' };
}

/**
 * 1件のoutbox行をECへ届けて結果を保存する。
 * 呼び出し側は行を processing に更新済み（claim）であること。
 */
async function deliverClaimedReward(
  db: D1Database,
  row: PhotoRewardOutboxRow,
  client: EcPhotoPointClient,
  options: { now: Date; fetcher: typeof fetch },
): Promise<RewardDeliveryOutcome> {
  const now = options.now;
  const nowIso = toJstString(now);
  const attemptCount = row.attempt_count + 1;
  let outcome: RewardDeliveryOutcome;
  try {
    const result = await awardEcPhotoPoint(
      client,
      { customerId: row.customer_id, points: row.points, awardKey: row.provider_award_key },
      options.fetcher,
    );
    const classified = classifyEcResult(result.status, result.body);
    outcome = classified.kind === 'retry_later'
      ? { kind: 'retry_later', reason: classified.reason, nextAttemptAt: backoffNextAttempt(now, attemptCount, classified.reason) }
      : classified;
  } catch (error) {
    console.error('photo reward delivery failed', row.id, error);
    outcome = {
      kind: 'retry_later',
      reason: 'ec_unavailable',
      nextAttemptAt: backoffNextAttempt(now, attemptCount, 'ec_unavailable'),
    };
  }
  if (outcome.kind === 'retry_later' && attemptCount >= PHOTO_REWARD_MAX_ATTEMPTS) {
    outcome = { kind: 'permanent', reason: 'attempts_exhausted' };
  }
  if (outcome.kind === 'synced') {
    await db.prepare(
      `UPDATE nen_photo_reward_outbox
         SET status = 'synced', attempt_count = ?, last_error = NULL,
             next_attempt_at = NULL, synced_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(attemptCount, nowIso, nowIso, row.id).run();
  } else if (outcome.kind === 'permanent') {
    await db.prepare(
      `UPDATE nen_photo_reward_outbox
         SET status = 'failed', attempt_count = ?, last_error = ?,
             next_attempt_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).bind(attemptCount, outcome.reason, nowIso, row.id).run();
  } else {
    await db.prepare(
      `UPDATE nen_photo_reward_outbox
         SET status = 'failed', attempt_count = ?, last_error = ?,
             next_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(attemptCount, outcome.reason, outcome.nextAttemptAt, nowIso, row.id).run();
  }
  return outcome;
}

/**
 * claim して届ける。`force`（採用直後・運用者の再試行/照合）は
 * next_attempt_at を待たず、期限切れの processing も回収する。
 * 返り値が null のときはほかの処理が現在扱っている。
 */
export async function deliverPhotoReward(
  db: D1Database,
  row: PhotoRewardOutboxRow,
  client: EcPhotoPointClient,
  options: { now: Date; fetcher?: typeof fetch; force?: boolean },
): Promise<RewardDeliveryOutcome | null> {
  const nowIso = toJstString(options.now);
  const leaseExpiredBefore = toJstString(new Date(options.now.getTime() - PHOTO_REWARD_CLAIM_LEASE_MS));
  // force時は次回時刻を待たずに取る。期限切れでない時刻だけを壁にする。
  const dueBefore = options.force ? '9999-12-31T23:59:59.999+09:00' : nowIso;
  const claimed = await db.prepare(
    `UPDATE nen_photo_reward_outbox
        SET status = 'processing', updated_at = ?
      WHERE id = ?
        AND (status IN ('pending', 'failed')
          OR (status = 'processing' AND updated_at < ?))
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
  ).bind(nowIso, row.id, leaseExpiredBefore, dueBefore).run();
  if (!claimed.meta.changes) return null;
  return deliverClaimedReward(db, row, client, { now: options.now, fetcher: options.fetcher ?? fetch });
}

/** 写真1件のoutboxを即時で届ける（採用直後・再試行・照合の共通入口）。 */
export type PhotoRewardAttempt =
  | { kind: 'no_reward' }
  | { kind: 'already_synced' }
  | { kind: 'busy' }
  | { kind: 'delivered'; outcome: RewardDeliveryOutcome; state: PhotoRewardDisplayState };

export async function attemptPhotoRewardForPhoto(
  db: D1Database,
  input: { photoId: string; lineAccountId: string },
  client: EcPhotoPointClient,
  options: { now: Date; fetcher?: typeof fetch },
): Promise<PhotoRewardAttempt> {
  const row = await db.prepare(
    `SELECT * FROM nen_photo_reward_outbox WHERE photo_id = ? AND line_account_id = ?`,
  ).bind(input.photoId, input.lineAccountId).first<PhotoRewardOutboxRow>();
  if (!row) return { kind: 'no_reward' };
  if (row.status === 'synced') return { kind: 'already_synced' };
  const outcome = await deliverPhotoReward(db, row, client, {
    now: options.now, fetcher: options.fetcher, force: true,
  });
  if (!outcome) return { kind: 'busy' };
  const latest = await db.prepare(
    `SELECT status, last_error, updated_at FROM nen_photo_reward_outbox WHERE id = ?`,
  ).bind(row.id).first<Pick<PhotoRewardOutboxRow, 'status' | 'last_error' | 'updated_at'>>();
  return {
    kind: 'delivered',
    outcome,
    state: latest ? photoRewardDisplayState(latest, options.now) : 'pending',
  };
}

/**
 * cron用の回収処理。期限の来た pending/failed を先着で処理する。
 * EC接続の設定が無い環境では何もしない（行は stale として一覧に残る）。
 */
export async function processDuePhotoRewards(
  db: D1Database,
  client: EcPhotoPointClient | undefined,
  options: { now: Date; limit?: number; fetcher?: typeof fetch },
): Promise<{ claimed: number; synced: number; failed: number; skipped: number }> {
  if (!client) return { claimed: 0, synced: 0, failed: 0, skipped: 0 };
  const nowIso = toJstString(options.now);
  const rows = await db.prepare(
    `SELECT * FROM nen_photo_reward_outbox
      WHERE status IN ('pending', 'failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at LIMIT ?`,
  ).bind(nowIso, options.limit ?? 50).all<PhotoRewardOutboxRow>();
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows.results) {
    const outcome = await deliverPhotoReward(db, row, client, {
      now: options.now, fetcher: options.fetcher,
    });
    if (!outcome) { skipped++; continue; }
    if (outcome.kind === 'synced') synced++;
    else failed++;
  }
  return { claimed: synced + failed + skipped, synced, failed, skipped };
}
