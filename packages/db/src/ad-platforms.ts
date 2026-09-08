import { boundedListLimit, jstNow } from './utils.js';

export interface AdPlatform {
  id: string;
  name: string;
  display_name: string | null;
  config: string;
  is_active: number;
  /** 所有するLINEアカウント。NULLは帰属不明の旧行(送信対象にしない)。 */
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

/** プラットフォームと友だちの所属が食い違う記録を残そうとしたときの誤り。 */
export class AdPlatformAccountMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdPlatformAccountMismatchError';
  }
}

export interface AdPlatformConfig {
  // Meta
  pixel_id?: string;
  access_token?: string;
  test_event_code?: string;
  // X
  api_key?: string;
  api_secret?: string;
  x_oauth_token?: string;
  x_oauth_token_secret?: string;
  conversion_id?: string;
  // Google
  customer_id?: string;
  conversion_action_id?: string;
  oauth_token?: string;
  developer_token?: string;
  // TikTok
  pixel_code?: string;
}

export interface AdConversionLog {
  id: string;
  ad_platform_id: string;
  friend_id: string;
  line_account_id: string | null;
  conversion_point_id: string | null;
  event_name: string;
  click_id: string | null;
  click_id_type: string | null;
  idempotency_key: string | null;
  lease_token: string | null;
  provider_event_id: string | null;
  status: string;
  request_body: string | null;
  response_body: string | null;
  error_message: string | null;
  created_at: string;
}

/**
 * 有効な広告設定のうち、指定アカウントのものだけ返す。
 * アカウントが空のときは空配列を返す(帰属不明の旧行へは送信しない)。
 */
export async function getActiveAdPlatforms(
  db: D1Database,
  lineAccountId?: string | null,
): Promise<AdPlatform[]> {
  if (!lineAccountId) return [];
  const result = await db
    .prepare(`SELECT * FROM ad_platforms WHERE is_active = 1 AND line_account_id = ?`)
    .bind(lineAccountId)
    .all<AdPlatform>();
  return result.results;
}

export async function getAdPlatformByName(
  db: D1Database,
  name: string,
  lineAccountId?: string | null,
): Promise<AdPlatform | null> {
  if (lineAccountId === undefined) {
    return db
      .prepare(`SELECT * FROM ad_platforms WHERE name = ? AND is_active = 1`)
      .bind(name)
      .first<AdPlatform>();
  }
  return db
    .prepare(`SELECT * FROM ad_platforms WHERE name = ? AND is_active = 1 AND line_account_id = ?`)
    .bind(name, lineAccountId)
    .first<AdPlatform>();
}

export async function getAdPlatforms(db: D1Database): Promise<AdPlatform[]> {
  const result = await db
    .prepare(`SELECT * FROM ad_platforms ORDER BY created_at DESC`)
    .all<AdPlatform>();
  return result.results;
}

export async function getAdPlatformById(
  db: D1Database,
  id: string,
): Promise<AdPlatform | null> {
  return db
    .prepare(`SELECT * FROM ad_platforms WHERE id = ?`)
    .bind(id)
    .first<AdPlatform>();
}

export async function createAdPlatform(
  db: D1Database,
  input: { name: string; displayName?: string | null; config: Record<string, unknown>; lineAccountId?: string | null },
): Promise<AdPlatform> {
  // 帰属のない設定は送信対象にならない。DBトリガと二重で必須化する。
  if (!input.lineAccountId) {
    throw new AdPlatformAccountMismatchError('ad_platforms の作成には lineAccountId が必須です');
  }
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO ad_platforms (id, name, display_name, config, is_active, line_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(id, input.name, input.displayName ?? null, JSON.stringify(input.config), input.lineAccountId, now, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM ad_platforms WHERE id = ?`)
    .bind(id)
    .first<AdPlatform>())!;
}

export async function updateAdPlatform(
  db: D1Database,
  id: string,
  input: { name?: string; displayName?: string | null; config?: Record<string, unknown>; isActive?: boolean; lineAccountId?: string | null },
): Promise<AdPlatform | null> {
  const now = jstNow();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  // 帰属を null へ戻す変更は受け付けない(DBトリガと二重で必須化する)。
  if (input.lineAccountId !== undefined && !input.lineAccountId) {
    throw new AdPlatformAccountMismatchError('ad_platforms の lineAccountId を空にはできません');
  }

  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.displayName !== undefined) { fields.push('display_name = ?'); values.push(input.displayName); }
  if (input.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(input.config)); }
  if (input.isActive !== undefined) { fields.push('is_active = ?'); values.push(input.isActive ? 1 : 0); }
  if (input.lineAccountId !== undefined) { fields.push('line_account_id = ?'); values.push(input.lineAccountId); }

  values.push(id);

  await db
    .prepare(`UPDATE ad_platforms SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare(`SELECT * FROM ad_platforms WHERE id = ?`).bind(id).first<AdPlatform>();
}

/** 書き込み時の所属条件。認可済みのアカウントだけを1文で絞る(TOCTOU対策)。 */
export interface AdPlatformWriteScope {
  accountIds: string[];
  includeUnassigned: boolean;
}

export function adPlatformAccountCondition(
  column: string,
  scope: AdPlatformWriteScope,
): { clause: string; bindings: unknown[] } {
  if (scope.accountIds.length) {
    const list = scope.accountIds.map(() => '?').join(',');
    return scope.includeUnassigned
      ? { clause: `(${column} IN (${list}) OR ${column} IS NULL)`, bindings: [...scope.accountIds] }
      : { clause: `${column} IN (${list})`, bindings: [...scope.accountIds] };
  }
  return scope.includeUnassigned
    ? { clause: `${column} IS NULL`, bindings: [] }
    : { clause: '1 = 0', bindings: [] };
}

function updateFieldClauses(input: {
  name?: string; displayName?: string | null; config?: Record<string, unknown>; isActive?: boolean; lineAccountId?: string | null;
}): { fields: string[]; values: unknown[] } {
  if (input.lineAccountId !== undefined && !input.lineAccountId) {
    throw new AdPlatformAccountMismatchError('ad_platforms の lineAccountId を空にはできません');
  }
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [jstNow()];
  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.displayName !== undefined) { fields.push('display_name = ?'); values.push(input.displayName); }
  if (input.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(input.config)); }
  if (input.isActive !== undefined) { fields.push('is_active = ?'); values.push(input.isActive ? 1 : 0); }
  if (input.lineAccountId !== undefined) { fields.push('line_account_id = ?'); values.push(input.lineAccountId); }
  return { fields, values };
}

/**
 * 認可済み所属を WHERE に含めた条件付き更新。読み取りと書き込みの間に
 * 帰属が変わっても、認可外の行には当たらない。適用行数を返す。
 */
export async function updateAdPlatformCAS(
  db: D1Database,
  id: string,
  scope: AdPlatformWriteScope,
  input: { name?: string; displayName?: string | null; config?: Record<string, unknown>; isActive?: boolean; lineAccountId?: string | null },
): Promise<{ applied: boolean; platform: AdPlatform | null }> {
  const { fields, values } = updateFieldClauses(input);
  const cond = adPlatformAccountCondition('line_account_id', scope);
  const result = await db
    .prepare(`UPDATE ad_platforms SET ${fields.join(', ')} WHERE id = ? AND ${cond.clause}`)
    .bind(...values, id, ...cond.bindings)
    .run<{ success: boolean; meta?: { changes?: number } }>();
  const changes = (result as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
  if (changes === 0) {
    return { applied: false, platform: null };
  }
  const platform = await db.prepare(`SELECT * FROM ad_platforms WHERE id = ?`).bind(id).first<AdPlatform>();
  return { applied: true, platform };
}

/** 認可済み所属を WHERE に含めた条件付き削除。削除行数を返す。 */
export async function deleteAdPlatformCAS(
  db: D1Database,
  id: string,
  scope: AdPlatformWriteScope,
): Promise<boolean> {
  const cond = adPlatformAccountCondition('line_account_id', scope);
  const result = await db
    .prepare(`DELETE FROM ad_platforms WHERE id = ? AND ${cond.clause}`)
    .bind(id, ...cond.bindings)
    .run<{ success: boolean; meta?: { changes?: number } }>();
  const changes = (result as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
  return changes > 0;
}

export async function deleteAdPlatform(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM ad_platforms WHERE id = ?`).bind(id).run();
}

/**
 * 送信記録を残す。プラットフォームの帰属と友だちの所属が違うときは残さず
 * AdPlatformAccountMismatchError を投げる(DB側の境界強制)。
 */
/**
 * 記録の所属を確定する。プラットフォームの帰属と友だちの所属が違うときは
 * AdPlatformAccountMismatchError を投げる(DB側の境界強制)。
 */
export async function assertAdConversionAccountBoundary(
  db: D1Database,
  opts: { platformId: string; friendId: string; lineAccountId?: string | null },
): Promise<string | null> {
  const platform = await db
    .prepare(`SELECT line_account_id FROM ad_platforms WHERE id = ?`)
    .bind(opts.platformId)
    .first<{ line_account_id: string | null }>();
  const friend = await db
    .prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
    .bind(opts.friendId)
    .first<{ line_account_id: string | null }>();
  const platformAccount = platform?.line_account_id ?? null;
  // 呼び出しが確定した所属(再送時は初回確保分)を正とし、友だちの現所属は問わない。
  // 友だちが移動した後に旧イベントを新所属へ誤送信しないため。
  const friendAccount = opts.lineAccountId ?? friend?.line_account_id ?? null;
  if (!platform || !friend || platformAccount !== friendAccount) {
    throw new AdPlatformAccountMismatchError(
      `ad_conversion_logs の境界違反: platform=${opts.platformId} account=${platformAccount} friend=${opts.friendId} account=${friendAccount}`,
    );
  }
  return friendAccount;
}

/**
 * 同じ(友だち・出来事・冪等キー)で初回に確保した所属を返す。
 * 再送時は友だちの現所属ではなく、ここで固定した所属で送る。
 */
export async function getPinnedAdConversionAccount(
  db: D1Database,
  opts: { friendId: string; eventName: string; idempotencyKey: string },
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT line_account_id FROM ad_conversion_logs
       WHERE friend_id = ? AND event_name = ? AND idempotency_key = ? LIMIT 1`,
    )
    .bind(opts.friendId, opts.eventName, opts.idempotencyKey)
    .first<{ line_account_id: string | null }>();
  return row?.line_account_id ?? null;
}

export async function logAdConversion(
  db: D1Database,
  opts: {
    platformId: string;
    friendId: string;
    lineAccountId?: string | null;
    eventName: string;
    clickId: string;
    clickIdType: string;
    status: 'sent' | 'failed';
    requestBody?: string | null;
    responseBody?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  const friendAccount = await assertAdConversionAccountBoundary(db, opts);

  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO ad_conversion_logs
       (id, ad_platform_id, friend_id, line_account_id, event_name, click_id, click_id_type, status, request_body, response_body, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.platformId,
      opts.friendId,
      friendAccount,
      opts.eventName,
      opts.clickId,
      opts.clickIdType,
      opts.status,
      opts.requestBody ?? null,
      opts.responseBody ?? null,
      opts.errorMessage ?? null,
      now,
    )
    .run();
}

export type AdConversionClaim = 'send' | 'skip-sent' | 'skip-inflight' | 'mismatch';

/** 送信中と見なす上限。超えた pending は落ちた確保と見て取り直せる。 */
export const AD_CONVERSION_PENDING_TAKEOVER_MS = 30 * 60 * 1000;

function conversionFingerprint(input: { clickId: string; clickIdType: string; eventValue?: number | null }): string {
  return JSON.stringify({ c: `${input.clickIdType}:${input.clickId}`, v: input.eventValue ?? null });
}

function fingerprintMatches(stored: string | null, expected: string): boolean {
  // 指紋のない旧行は比較できないので、状態の判定に任せる。
  if (stored == null || stored === '') return true;
  return stored === expected;
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /unique/i.test(message);
}

/**
 * 送信権を確保する。同じ(設定・友だち・出来事・冪等キー)の送信済み・送信中が
 * あるときは送らず、失敗済みのときだけ1回だけ取り直せる。同時実行の勝敗は
 * UNIQUE制約の1文で決める。
 */
export interface AdConversionClaimResult {
  disposition: AdConversionClaim;
  /** disposition が send のとき必須の確保証。確定時に提示する。 */
  lease: string | null;
  /** 確保済みの媒体側安定ID。再送は保存分を使い続ける。 */
  providerEventId: string | null;
}

/** 古い持ち主の確定を拒んだときの誤り。 */
export class AdConversionLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdConversionLeaseError';
  }
}

export async function claimAdConversionSend(
  db: D1Database,
  opts: {
    platformId: string;
    friendId: string;
    lineAccountId?: string | null;
    eventName: string;
    clickId: string;
    clickIdType: string;
    eventValue?: number | null;
    idempotencyKey: string;
    providerEventId?: string | null;
  },
): Promise<AdConversionClaimResult> {
  const friendAccount = await assertAdConversionAccountBoundary(db, opts);
  const now = jstNow();
  const fingerprint = conversionFingerprint({ clickId: opts.clickId, clickIdType: opts.clickIdType, eventValue: opts.eventValue });
  const providerEventId = opts.providerEventId || `${opts.idempotencyKey}:${opts.platformId}`;
  const lease = crypto.randomUUID();

  try {
    await db
      .prepare(
        `INSERT INTO ad_conversion_logs
         (id, ad_platform_id, friend_id, line_account_id, event_name, click_id, click_id_type, status, idempotency_key, request_body, lease_token, provider_event_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        opts.platformId,
        opts.friendId,
        friendAccount,
        opts.eventName,
        opts.clickId,
        opts.clickIdType,
        opts.idempotencyKey,
        fingerprint,
        lease,
        providerEventId,
        now,
      )
      .run();
    return { disposition: 'send', lease, providerEventId };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const existing = await db
    .prepare(
      `SELECT status, click_id, click_id_type, request_body, created_at, lease_token, provider_event_id FROM ad_conversion_logs
       WHERE ad_platform_id = ? AND friend_id = ? AND event_name = ? AND idempotency_key = ?`,
    )
    .bind(opts.platformId, opts.friendId, opts.eventName, opts.idempotencyKey)
    .first<{
      status: string; click_id: string | null; click_id_type: string | null;
      request_body: string | null; created_at: string;
      lease_token: string | null; provider_event_id: string | null;
    }>();
  if (!existing) return { disposition: 'send', lease: null, providerEventId: null };
  // 同じ鍵で金額・クリックID等が変われば別内容。再送ではなく要確認にする。
  if (!fingerprintMatches(existing.request_body, fingerprint)) {
    if (existing.status === 'pending' || existing.status === 'failed') {
      await db
        .prepare(
          `UPDATE ad_conversion_logs SET status = 'needs-review'
           WHERE ad_platform_id = ? AND friend_id = ? AND event_name = ? AND idempotency_key = ?
             AND status IN ('pending', 'failed')`,
        )
        .bind(opts.platformId, opts.friendId, opts.eventName, opts.idempotencyKey)
        .run();
    }
    return { disposition: 'mismatch', lease: null, providerEventId: existing.provider_event_id };
  }
  if (existing.status === 'sent' || existing.status === 'success') {
    return { disposition: 'skip-sent', lease: null, providerEventId: existing.provider_event_id };
  }
  if (existing.status !== 'failed') {
    if (existing.status !== 'pending') {
      return { disposition: 'mismatch', lease: null, providerEventId: existing.provider_event_id };
    }
    // 確保したまま落ちた分は永久に止めない。古い pending だけ取り直す。
    const ageMs = Date.now() - Date.parse(existing.created_at);
    if (!Number.isFinite(ageMs) || ageMs <= AD_CONVERSION_PENDING_TAKEOVER_MS) {
      return { disposition: 'skip-inflight', lease: null, providerEventId: existing.provider_event_id };
    }
  }
  // 失敗済み・古い pending を取り直す。見た状態・時刻を条件に入れ、
  // 同時に取り合っても勝った1件だけ送る。証と時刻を更新して連鎖を止める。
  const newLease = crypto.randomUUID();
  const took = await db
    .prepare(
      `UPDATE ad_conversion_logs SET status = 'pending', request_body = ?, lease_token = ?, created_at = ?
       WHERE ad_platform_id = ? AND friend_id = ? AND event_name = ? AND idempotency_key = ?
         AND status = ? AND created_at = ?`,
    )
    .bind(fingerprint, newLease, now, opts.platformId, opts.friendId, opts.eventName, opts.idempotencyKey, existing.status, existing.created_at)
    .run<{ success: boolean; meta?: { changes?: number } }>();
  const changes = (took as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
  if (changes === 0) {
    return { disposition: 'skip-inflight', lease: null, providerEventId: existing.provider_event_id };
  }
  return { disposition: 'send', lease: newLease, providerEventId: existing.provider_event_id };
}

/**
 * 確保した送信の結果を記録する。確保証と pending の両方を条件にし、
 * 古い持ち主の確定は通さない(AdConversionLeaseError)。
 */
export async function finishAdConversionSend(
  db: D1Database,
  opts: {
    platformId: string;
    friendId: string;
    eventName: string;
    idempotencyKey: string;
    lease: string;
    status: 'sent' | 'failed';
    errorMessage?: string | null;
  },
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE ad_conversion_logs SET status = ?, error_message = ?
       WHERE ad_platform_id = ? AND friend_id = ? AND event_name = ? AND idempotency_key = ?
         AND status = 'pending' AND lease_token = ?`,
    )
    .bind(opts.status, opts.errorMessage ?? null, opts.platformId, opts.friendId, opts.eventName, opts.idempotencyKey, opts.lease)
    .run<{ success: boolean; meta?: { changes?: number } }>();
  const changes = (result as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
  if (changes === 0) {
    throw new AdConversionLeaseError(
      `ad_conversion_logs の確定拒否: platform=${opts.platformId} friend=${opts.friendId} event=${opts.eventName}`,
    );
  }
}

export async function getAdConversionLogs(
  db: D1Database,
  platformId: string,
  limit = 50,
): Promise<AdConversionLog[]> {
  const safeLimit = boundedListLimit(limit, 50);
  const result = await db
    .prepare(
      `SELECT * FROM ad_conversion_logs WHERE ad_platform_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(platformId, safeLimit)
    .all<AdConversionLog>();
  return result.results;
}
