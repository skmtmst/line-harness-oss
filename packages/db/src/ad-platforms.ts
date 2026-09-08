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
): Promise<AdPlatform | null> {
  return db
    .prepare(`SELECT * FROM ad_platforms WHERE name = ? AND is_active = 1`)
    .bind(name)
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
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO ad_platforms (id, name, display_name, config, is_active, line_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(id, input.name, input.displayName ?? null, JSON.stringify(input.config), input.lineAccountId ?? null, now, now)
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
  const friendAccount = friend?.line_account_id ?? opts.lineAccountId ?? null;
  if (!platform || !friend || platformAccount !== friendAccount) {
    throw new AdPlatformAccountMismatchError(
      `ad_conversion_logs の境界違反: platform=${opts.platformId} account=${platformAccount} friend=${opts.friendId} account=${friendAccount}`,
    );
  }
  return friendAccount;
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

export type AdConversionClaim = 'send' | 'skip-sent' | 'skip-inflight';

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /unique/i.test(message);
}

/**
 * 送信権を確保する。同じ(設定・友だち・出来事・冪等キー)の送信済み・送信中が
 * あるときは送らず、失敗済みのときだけ1回だけ取り直せる。同時実行の勝敗は
 * UNIQUE制約の1文で決める。
 */
export async function claimAdConversionSend(
  db: D1Database,
  opts: {
    platformId: string;
    friendId: string;
    lineAccountId?: string | null;
    eventName: string;
    clickId: string;
    clickIdType: string;
    idempotencyKey: string;
  },
): Promise<AdConversionClaim> {
  const friendAccount = await assertAdConversionAccountBoundary(db, opts);
  const now = jstNow();

  try {
    await db
      .prepare(
        `INSERT INTO ad_conversion_logs
         (id, ad_platform_id, friend_id, line_account_id, event_name, click_id, click_id_type, status, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
        now,
      )
      .run();
    return 'send';
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const existing = await db
    .prepare(
      `SELECT status FROM ad_conversion_logs
       WHERE ad_platform_id = ? AND friend_id = ? AND event_name = ? AND idempotency_key = ?`,
    )
    .bind(opts.platformId, opts.friendId, opts.eventName, opts.idempotencyKey)
    .first<{ status: string }>();
  if (!existing) return 'send';
  if (existing.status === 'sent') return 'skip-sent';
  if (existing.status === 'pending') return 'skip-inflight';
  // 失敗済みは1回だけ取り直す。同時に取り合ったら勝った1件だけ送る。
  const took = await db
    .prepare(
      `UPDATE ad_conversion_logs SET status = 'pending'
       WHERE ad_platform_id = ? AND friend_id = ? AND event_name = ? AND idempotency_key = ?
         AND status = 'failed'`,
    )
    .bind(opts.platformId, opts.friendId, opts.eventName, opts.idempotencyKey)
    .run<{ success: boolean; meta?: { changes?: number } }>();
  const changes = (took as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
  return changes > 0 ? 'send' : 'skip-inflight';
}

/** 確保した送信の結果を記録する。 */
export async function finishAdConversionSend(
  db: D1Database,
  opts: {
    platformId: string;
    friendId: string;
    eventName: string;
    idempotencyKey: string;
    status: 'sent' | 'failed';
    errorMessage?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE ad_conversion_logs SET status = ?, error_message = ?
       WHERE ad_platform_id = ? AND friend_id = ? AND event_name = ? AND idempotency_key = ?`,
    )
    .bind(opts.status, opts.errorMessage ?? null, opts.platformId, opts.friendId, opts.eventName, opts.idempotencyKey)
    .run();
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
