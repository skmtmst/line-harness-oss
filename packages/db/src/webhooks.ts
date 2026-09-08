import { decryptCredential, encryptCredential } from './credential-crypto.js';
import { jstNow, toJstString } from './utils.js';
// Webhook IN/OUT クエリヘルパー

/**
 * 受信・送信Webhookの secret の最低文字数。API の入力検査と旧平文の表示判定は
 * この値だけを見る。apps/worker/src/routes/webhooks.ts はこれを読み替えて使う。
 */
export const WEBHOOK_SECRET_MIN_LENGTH = 32;

export interface IncomingWebhookRow {
  id: string;
  name: string;
  source_type: string;
  /** 旧平文。#650 以降の新規・更新では NULL になる。読み取りの後方互換だけに使う。 */
  secret: string | null;
  /** AES-GCM 暗号文。#650 以降の正本。旧スキーマの行には無いことがある。 */
  secret_encrypted?: string | null;
  is_active: number;
  line_account_id: string | null;
  version: number;
  identity_match_json: string;
  action_refs_json: string;
  latest_masked_sample_json: string | null;
  latest_received_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutgoingWebhookDeliverySummaryRow {
  webhook_id: string;
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  last_status: WebhookInteractionStatus | null;
  last_response_status: number | null;
  last_completed_at: string | null;
  last_failure_reason: WebhookInteractionFailureReason | null;
  can_retry: number;
}

export interface OutgoingWebhookRow {
  id: string;
  name: string;
  url: string;
  event_types: string; // JSON配列
  /** 旧平文。#650 以降の新規・更新では NULL になる。読み取りの後方互換だけに使う。 */
  secret: string | null;
  /** AES-GCM 暗号文。#650 以降の正本。旧スキーマの行には無いことがある。 */
  secret_encrypted?: string | null;
  is_active: number;
  /** 失敗したとき何回まで送り直すか。0 なら送り直さない */
  max_retries: number;
  /** 連続して失敗している回数。成功すると 0 に戻る */
  consecutive_failures: number;
  /** 最後に失敗した時刻。成功すると NULL に戻る */
  last_failed_at: string | null;
  line_account_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type WebhookInteractionDirection = 'outgoing' | 'incoming';
export type WebhookInteractionStatus = 'pending' | 'succeeded' | 'failed' | 'retried';
export type WebhookInteractionFailureReason =
  | 'connection_failed'
  | 'response_4xx'
  | 'response_429'
  | 'response_5xx'
  | 'processing_failed'
  | 'unknown';

export interface WebhookInteractionRow {
  id: string;
  line_account_id: string;
  direction: WebhookInteractionDirection;
  webhook_id: string | null;
  webhook_name: string;
  event_type: string;
  trigger_summary: string;
  status: WebhookInteractionStatus;
  request_body_json: string | null;
  response_status: number | null;
  attempt_count: number;
  duration_ms: number | null;
  failure_reason: WebhookInteractionFailureReason | null;
  idempotency_key: string;
  retry_of_id: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface WebhookInteractionSummary {
  total: number;
  outgoing: number;
  incoming: number;
  succeeded: number;
  failed: number;
  averageDurationMs: number | null;
}

export async function createWebhookInteraction(
  db: D1Database,
  input: {
    id?: string;
    lineAccountId: string;
    direction: WebhookInteractionDirection;
    webhookId?: string | null;
    webhookName: string;
    eventType: string;
    triggerSummary: string;
    requestBodyJson?: string | null;
    idempotencyKey?: string;
    retryOfId?: string | null;
    startedAt?: string;
  },
): Promise<WebhookInteractionRow> {
  const id = input.id ?? crypto.randomUUID();
  const now = input.startedAt ?? jstNow();
  await db.prepare(
    `INSERT INTO webhook_interaction_logs
       (id, line_account_id, direction, webhook_id, webhook_name, event_type,
        trigger_summary, status, request_body_json, response_status,
        attempt_count, duration_ms, failure_reason, idempotency_key,
        retry_of_id, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, 0, NULL, NULL, ?, ?, ?, NULL, ?)`,
  ).bind(
    id,
    input.lineAccountId,
    input.direction,
    input.webhookId ?? null,
    input.webhookName,
    input.eventType,
    input.triggerSummary,
    input.requestBodyJson ?? null,
    input.idempotencyKey ?? crypto.randomUUID(),
    input.retryOfId ?? null,
    now,
    now,
  ).run();
  return (await getWebhookInteractionById(db, id, input.lineAccountId))!;
}

export async function finishWebhookInteraction(
  db: D1Database,
  id: string,
  lineAccountId: string,
  input: {
    status: 'succeeded' | 'failed';
    responseStatus?: number | null;
    attemptCount: number;
    durationMs: number;
    failureReason?: WebhookInteractionFailureReason | null;
    completedAt?: string;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE webhook_interaction_logs
        SET status=?, response_status=?, attempt_count=?, duration_ms=?,
            failure_reason=?, completed_at=?
      WHERE id=? AND line_account_id=? AND status='pending'`,
  ).bind(
    input.status,
    input.responseStatus ?? null,
    input.attemptCount,
    Math.max(0, Math.round(input.durationMs)),
    input.failureReason ?? null,
    input.completedAt ?? jstNow(),
    id,
    lineAccountId,
  ).run();
}

export async function getWebhookInteractionById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<WebhookInteractionRow | null> {
  return db.prepare(
    'SELECT * FROM webhook_interaction_logs WHERE id=? AND line_account_id=?',
  ).bind(id, lineAccountId).first<WebhookInteractionRow>();
}

export async function claimWebhookInteractionRetry(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE webhook_interaction_logs SET status='retried'
      WHERE id=? AND line_account_id=? AND direction='outgoing' AND status='failed'`,
  ).bind(id, lineAccountId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function restoreWebhookInteractionFailure(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE webhook_interaction_logs SET status='failed'
      WHERE id=? AND line_account_id=? AND status='retried'`,
  ).bind(id, lineAccountId).run();
}

export async function listWebhookInteractions(
  db: D1Database,
  input: {
    lineAccountId: string;
    periodDays?: number;
    direction?: WebhookInteractionDirection;
    status?: 'succeeded' | 'failed';
    search?: string;
    page?: number;
    limit?: number;
  },
): Promise<{
  items: WebhookInteractionRow[];
  total: number;
  page: number;
  limit: number;
  summary: WebhookInteractionSummary;
}> {
  const integerOr = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) ? Math.floor(value as number) : fallback;
  const periodDays = Math.min(365, Math.max(1, integerOr(input.periodDays, 30)));
  const cutoff = toJstString(new Date(Date.now() - periodDays * 86_400_000));
  const page = Math.max(1, integerOr(input.page, 1));
  const limit = Math.min(50, Math.max(10, integerOr(input.limit, 20)));
  const clauses = ['line_account_id=?', 'created_at>=?', "status!='retried'"];
  const binds: unknown[] = [input.lineAccountId, cutoff];
  if (input.direction) {
    clauses.push('direction=?');
    binds.push(input.direction);
  }
  if (input.status) {
    clauses.push('status=?');
    binds.push(input.status);
  }
  if (input.search?.trim()) {
    clauses.push('(webhook_name LIKE ? OR trigger_summary LIKE ? OR event_type LIKE ?)');
    const like = `%${input.search.trim().slice(0, 100)}%`;
    binds.push(like, like, like);
  }
  const where = clauses.join(' AND ');
  const [rows, totalRow, summaryRow] = await Promise.all([
    db.prepare(
      `SELECT * FROM webhook_interaction_logs WHERE ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...binds, limit, (page - 1) * limit).all<WebhookInteractionRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM webhook_interaction_logs WHERE ${where}`)
      .bind(...binds).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN direction='outgoing' THEN 1 ELSE 0 END) AS outgoing,
              SUM(CASE WHEN direction='incoming' THEN 1 ELSE 0 END) AS incoming,
              SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
              AVG(CASE WHEN status IN ('succeeded','failed') THEN duration_ms END) AS average_duration_ms
         FROM webhook_interaction_logs
        WHERE line_account_id=? AND created_at>=? AND status!='retried'`,
    ).bind(input.lineAccountId, cutoff).first<Record<string, number | null>>(),
  ]);
  return {
    items: rows.results ?? [],
    total: totalRow?.count ?? 0,
    page,
    limit,
    summary: {
      total: summaryRow?.total ?? 0,
      outgoing: summaryRow?.outgoing ?? 0,
      incoming: summaryRow?.incoming ?? 0,
      succeeded: summaryRow?.succeeded ?? 0,
      failed: summaryRow?.failed ?? 0,
      averageDurationMs: summaryRow?.average_duration_ms == null
        ? null
        : Math.round(summaryRow.average_duration_ms),
    },
  };
}

export async function listFailedWebhookInteractionsForRetry(
  db: D1Database,
  lineAccountId: string,
  limit = 50,
): Promise<WebhookInteractionRow[]> {
  const result = await db.prepare(
    `SELECT * FROM webhook_interaction_logs
      WHERE line_account_id=? AND direction='outgoing' AND status='failed'
      ORDER BY created_at ASC LIMIT ?`,
  ).bind(lineAccountId, Math.min(50, Math.max(1, limit))).all<WebhookInteractionRow>();
  return result.results ?? [];
}

export async function getOutgoingWebhookDeliverySummaries(
  db: D1Database,
  lineAccountId: string,
  periodDays = 30,
): Promise<OutgoingWebhookDeliverySummaryRow[]> {
  const days = Math.min(365, Math.max(1, Math.floor(periodDays)));
  const cutoff = toJstString(new Date(Date.now() - days * 86_400_000));
  const result = await db.prepare(`
    WITH recent AS (
      SELECT *
        FROM webhook_interaction_logs
       WHERE line_account_id = ? AND direction = 'outgoing'
         AND created_at >= ? AND status != 'retried'
    ), totals AS (
      SELECT webhook_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
        FROM recent
       WHERE webhook_id IS NOT NULL
       GROUP BY webhook_id
    ), latest AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY webhook_id ORDER BY created_at DESC, id DESC
      ) AS row_number
        FROM recent
       WHERE webhook_id IS NOT NULL
    )
    SELECT ow.id AS webhook_id,
           COALESCE(t.total, 0) AS total,
           COALESCE(t.succeeded, 0) AS succeeded,
           COALESCE(t.failed, 0) AS failed,
           COALESCE(t.pending, 0) AS pending,
           l.status AS last_status,
           l.response_status AS last_response_status,
           l.completed_at AS last_completed_at,
           l.failure_reason AS last_failure_reason,
           CASE WHEN ow.is_active = 1 AND l.status = 'failed'
                  AND l.request_body_json IS NOT NULL THEN 1 ELSE 0 END AS can_retry
      FROM outgoing_webhooks ow
 LEFT JOIN totals t ON t.webhook_id = ow.id
 LEFT JOIN latest l ON l.webhook_id = ow.id AND l.row_number = 1
     WHERE ow.line_account_id = ?
     ORDER BY ow.created_at DESC, ow.id ASC
  `).bind(lineAccountId, cutoff, lineAccountId).all<OutgoingWebhookDeliverySummaryRow>();
  return result.results ?? [];
}

/**
 * Webhook secret の暗号化の約束(#650)。
 *
 * - 新規・更新時は secret_encrypted 列へ AES-GCM で暗号化して保存し、
 *   secret 列には平文を残さない。鍵は LINE_CREDENTIAL_ENCRYPTION_KEY。
 * - 平文で返すのは作成直後の1回だけ(API層)。GET・ログ・エラーには出さない。
 * - 送信・照合の直前だけ復号する。鍵不足・復号失敗は例外にして止める。
 * - 旧平文の行はそのまま読める。再保存(更新)時に暗号化へ移行する。
 * - 平文列の廃止は、暗号化の行き渡り確認後に別の票で行う。
 *
 * 鍵ローテーション方針:
 * 1. 新鍵を用意し、旧鍵を残したまま secret を入れ直す(復号→再暗号化)。
 * 2. 全行の secret_encrypted が新鍵で読めることを確かめてから旧鍵を捨てる。
 * 3. LINE資格情報と同じ単一鍵方式のため、新旧2鍵の併用期間は設けない。
 */
export type WebhookSecretColumns = {
  id?: string;
  secret: string | null;
  secret_encrypted?: string | null;
};

async function readWorkerEncryptionKey(): Promise<string | undefined> {
  try {
    // Worker は bindings から読む。Node の単体テストには bindings がないため、
    // その場合は呼び出し側が渡した鍵だけを使う(暗号化の書き込みは鍵必須)。
    const runtime = await import('cloudflare:workers');
    const bindings = runtime.env as unknown as { LINE_CREDENTIAL_ENCRYPTION_KEY?: string };
    return bindings.LINE_CREDENTIAL_ENCRYPTION_KEY?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** 平文を1件暗号化する。鍵がなければ書かずに例外にする(平文保存をしないため)。 */
export async function encryptWebhookSecret(
  value: string,
  credentialEncryptionKey?: string,
): Promise<string> {
  const key = credentialEncryptionKey?.trim() || await readWorkerEncryptionKey();
  return encryptCredential(value, key);
}

/**
 * 送信・照合の直前だけ呼ぶ。暗号文があれば復号し、旧平文だけの行はそのまま返す。
 * 鍵不足・復号失敗は例外にする(呼び出し側は安全に止める)。戻り値 null は未設定。
 * 例外とログに秘密値・鍵は含めない。
 */
export async function resolveWebhookSecret(
  row: WebhookSecretColumns,
  credentialEncryptionKey?: string,
): Promise<string | null> {
  if (row.secret_encrypted) {
    const key = credentialEncryptionKey?.trim() || await readWorkerEncryptionKey();
    try {
      return await decryptCredential(row.secret_encrypted, key);
    } catch {
      console.error(JSON.stringify({
        event: 'webhook_secret_decrypt_failed',
        webhookId: row.id ?? null,
      }));
      throw new Error('Unable to decrypt webhook secret');
    }
  }
  return row.secret;
}

/** 一覧・詳細の hasSecret 判定。秘密値そのものは返さない。 */
export function hasWebhookSecret(row: WebhookSecretColumns): boolean {
  if (row.secret_encrypted) return true;
  return !!row.secret && row.secret.length >= WEBHOOK_SECRET_MIN_LENGTH;
}

/**
 * 旧平文が残る行を暗号化へ移す。secret を含まない更新でも再保存時に寄せる。
 * 鍵がなければ何もせず残す(無関係な更新を止めない)。送信時は復号失敗で止める。
 */
async function migrateLegacyWebhookSecret(
  db: D1Database,
  table: 'incoming_webhooks' | 'outgoing_webhooks',
  id: string,
  lineAccountId: string,
  credentialEncryptionKey?: string,
): Promise<void> {
  const row = await db.prepare(
    `SELECT secret, secret_encrypted FROM ${table} WHERE id = ? AND line_account_id = ?`,
  ).bind(id, lineAccountId).first<{ secret: string | null; secret_encrypted: string | null }>();
  if (!row?.secret || row.secret_encrypted) return;
  let encrypted: string;
  try {
    encrypted = await encryptWebhookSecret(row.secret, credentialEncryptionKey);
  } catch {
    console.warn(JSON.stringify({
      event: 'webhook_secret_migration_skipped',
      webhookId: id,
    }));
    return;
  }
  await db.prepare(
    `UPDATE ${table} SET secret_encrypted = ?, secret = NULL, updated_at = ?
      WHERE id = ? AND line_account_id = ?`,
  ).bind(encrypted, jstNow(), id, lineAccountId).run();
}

// --- 受信Webhook ---

export async function getIncomingWebhooks(
  db: D1Database,
  lineAccountId: string,
): Promise<IncomingWebhookRow[]> {
  const result = await db
    .prepare(`SELECT * FROM incoming_webhooks WHERE line_account_id = ? ORDER BY created_at DESC`)
    .bind(lineAccountId)
    .all<IncomingWebhookRow>();
  return result.results;
}

export async function getIncomingWebhookById(
  db: D1Database,
  id: string,
  lineAccountId?: string,
): Promise<IncomingWebhookRow | null> {
  if (lineAccountId === undefined) {
    return db.prepare(`SELECT * FROM incoming_webhooks WHERE id = ?`).bind(id).first<IncomingWebhookRow>();
  }
  return db
    .prepare(`SELECT * FROM incoming_webhooks WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<IncomingWebhookRow>();
}

export type IncomingWebhookIdentityMatch = {
  methods: Array<{
    kind: 'harness_friend_id' | 'external_customer_id' | 'verified_email' | 'verified_phone';
    path: string;
  }>;
  onNotFound: 'do_nothing' | 'unmatched_box' | 'create_candidate';
};

export type IncomingWebhookActionRef = {
  refKind: string;
  refId: string;
  refVersionId: string | null;
};

export async function updateIncomingWebhookConfig(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedVersion: number;
    identityMatching: IncomingWebhookIdentityMatch;
    actions: IncomingWebhookActionRef[];
  },
): Promise<
  | { status: 'updated'; item: IncomingWebhookRow }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'not_found' }
> {
  const result = await db.prepare(`UPDATE incoming_webhooks
    SET identity_match_json = ?, action_refs_json = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND line_account_id = ? AND version = ?`)
    .bind(
      JSON.stringify(input.identityMatching),
      JSON.stringify(input.actions),
      jstNow(),
      input.id,
      input.lineAccountId,
      input.expectedVersion,
    )
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    return {
      status: 'updated',
      item: (await getIncomingWebhookById(db, input.id, input.lineAccountId))!,
    };
  }
  const current = await getIncomingWebhookById(db, input.id, input.lineAccountId);
  return current
    ? { status: 'conflict', currentVersion: Number(current.version) }
    : { status: 'not_found' };
}

export async function updateIncomingWebhookMaskedSample(
  db: D1Database,
  id: string,
  lineAccountId: string,
  maskedSample: unknown,
  receivedAt = jstNow(),
): Promise<void> {
  await db.prepare(`UPDATE incoming_webhooks
    SET latest_masked_sample_json = ?, latest_received_at = ?
    WHERE id = ? AND line_account_id = ?`)
    .bind(JSON.stringify(maskedSample), receivedAt, id, lineAccountId)
    .run();
}

export async function createIncomingWebhook(
  db: D1Database,
  input: { name: string; sourceType?: string; secret?: string; lineAccountId: string },
  credentialEncryptionKey?: string,
): Promise<IncomingWebhookRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  // secret があるときは暗号化して保存し、平文は残さない。鍵がなければ例外にする。
  const encrypted = input.secret === undefined
    ? null
    : await encryptWebhookSecret(input.secret, credentialEncryptionKey);
  await db
    .prepare(`INSERT INTO incoming_webhooks (id, name, source_type, secret, secret_encrypted, line_account_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`)
    .bind(id, input.name, input.sourceType ?? 'custom', encrypted, input.lineAccountId, now, now)
    .run();
  return (await getIncomingWebhookById(db, id, input.lineAccountId))!;
}

export async function updateIncomingWebhook(
  db: D1Database,
  id: string,
  lineAccountId: string,
  updates: Partial<{ name: string; sourceType: string; secret: string; isActive: boolean }>,
  credentialEncryptionKey?: string,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.sourceType !== undefined) { sets.push('source_type = ?'); values.push(updates.sourceType); }
  if (updates.secret !== undefined) {
    // 入れ直しは暗号化して保存し、旧平文を消す。鍵がなければ例外にする。
    sets.push('secret_encrypted = ?');
    values.push(await encryptWebhookSecret(updates.secret, credentialEncryptionKey));
    sets.push('secret = NULL');
  }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) {
    await migrateLegacyWebhookSecret(db, 'incoming_webhooks', id, lineAccountId, credentialEncryptionKey);
    return;
  }
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  values.push(lineAccountId);
  await db.prepare(`UPDATE incoming_webhooks SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`)
    .bind(...values).run();
  await migrateLegacyWebhookSecret(db, 'incoming_webhooks', id, lineAccountId, credentialEncryptionKey);
}

export async function deleteIncomingWebhook(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(`DELETE FROM incoming_webhooks WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).run();
}

// --- 送信Webhook ---
export async function getOutgoingWebhooks(
  db: D1Database,
  lineAccountId: string,
): Promise<OutgoingWebhookRow[]> {
  const result = await db
    .prepare(`SELECT * FROM outgoing_webhooks WHERE line_account_id = ? ORDER BY created_at DESC`)
    .bind(lineAccountId)
    .all<OutgoingWebhookRow>();
  return result.results;
}

export async function getOutgoingWebhookById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<OutgoingWebhookRow | null> {
  return db
    .prepare(`SELECT * FROM outgoing_webhooks WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<OutgoingWebhookRow>();
}

export async function createOutgoingWebhook(
  db: D1Database,
  input: { name: string; url: string; eventTypes: string[]; secret?: string; maxRetries?: number; lineAccountId: string },
  credentialEncryptionKey?: string,
): Promise<OutgoingWebhookRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  // secret があるときは暗号化して保存し、平文は残さない。鍵がなければ例外にする。
  const encrypted = input.secret === undefined
    ? null
    : await encryptWebhookSecret(input.secret, credentialEncryptionKey);
  await db
    .prepare(`INSERT INTO outgoing_webhooks (id, name, url, event_types, secret, secret_encrypted, max_retries, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.url, JSON.stringify(input.eventTypes), encrypted, input.maxRetries ?? 0, input.lineAccountId, now, now)
    .run();
  return (await getOutgoingWebhookById(db, id, input.lineAccountId))!;
}

export async function updateOutgoingWebhook(
  db: D1Database,
  id: string,
  lineAccountId: string,
  updates: Partial<{
    name: string;
    url: string;
    eventTypes: string[];
    secret: string;
    isActive: boolean;
    maxRetries: number;
  }>,
  credentialEncryptionKey?: string,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.url !== undefined) { sets.push('url = ?'); values.push(updates.url); }
  if (updates.eventTypes !== undefined) { sets.push('event_types = ?'); values.push(JSON.stringify(updates.eventTypes)); }
  if (updates.secret !== undefined) {
    // 入れ直しは暗号化して保存し、旧平文を消す。鍵がなければ例外にする。
    sets.push('secret_encrypted = ?');
    values.push(await encryptWebhookSecret(updates.secret, credentialEncryptionKey));
    sets.push('secret = NULL');
  }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.maxRetries !== undefined) { sets.push('max_retries = ?'); values.push(updates.maxRetries); }
  if (sets.length === 0) {
    await migrateLegacyWebhookSecret(db, 'outgoing_webhooks', id, lineAccountId, credentialEncryptionKey);
    return;
  }
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  values.push(lineAccountId);
  await db.prepare(`UPDATE outgoing_webhooks SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`)
    .bind(...values).run();
  await migrateLegacyWebhookSecret(db, 'outgoing_webhooks', id, lineAccountId, credentialEncryptionKey);
}

export async function deleteOutgoingWebhook(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(`DELETE FROM outgoing_webhooks WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).run();
}

/** 指定イベントタイプに一致するアクティブな送信Webhookを取得 */
export async function getActiveOutgoingWebhooksByEvent(
  db: D1Database,
  eventType: string,
  lineAccountId?: string | null,
): Promise<OutgoingWebhookRow[]> {
  if (!lineAccountId) return [];
  const all = await db
    .prepare(`
      SELECT *
      FROM outgoing_webhooks
      WHERE is_active = 1 AND line_account_id = ?
    `)
    .bind(lineAccountId)
    .all<OutgoingWebhookRow>();
  return all.results.filter((w) => {
    const types: string[] = JSON.parse(w.event_types);
    return types.includes(eventType) || types.includes('*');
  });
}
