import { incomingWebhookFencedDb } from './incoming-webhook-fenced-db.js';
import type {
  IncomingWebhookActionRef,
  IncomingWebhookIdentityMatch,
} from '@line-crm/db';

/** A receipt survives request failures; only completed work is acknowledged as a duplicate. */
const LEASE_MS = 300_000;

export interface IncomingWebhookExecution {
  db: D1Database;
  sourceEventId: string;
  occurredAt: string;
  step<T>(key: string, work: () => Promise<T>): Promise<T>;
  complete(): Promise<void>;
  fail(): Promise<void>;
}

/**
 * R402: 受領時の実行計画。照合方法・未一致時の扱い・処理配列全体・参照版を
 * 受領行へ固定し、再試行は後日の設定変更に影響されず元の計画を使う。
 */
export interface IncomingWebhookReceiptPlan {
  configVersion: number | null;
  identityMatching: IncomingWebhookIdentityMatch;
  actions: IncomingWebhookActionRef[];
}

const RECEIPT_PLAN_FALLBACK: IncomingWebhookReceiptPlan = {
  configVersion: null,
  identityMatching: { methods: [], onNotFound: 'do_nothing' },
  actions: [],
};

function parseReceiptPlan(row: {
  config_version: number | null;
  identity_match_json: string | null;
  action_refs_json: string | null;
}): IncomingWebhookReceiptPlan | null {
  if (row.identity_match_json === null || row.action_refs_json === null) return null;
  try {
    const identityMatching = JSON.parse(row.identity_match_json) as IncomingWebhookIdentityMatch;
    const actions = JSON.parse(row.action_refs_json) as IncomingWebhookActionRef[];
    if (!identityMatching || typeof identityMatching !== 'object' || !Array.isArray(actions)) return null;
    if (!['do_nothing', 'unmatched_box', 'create_candidate'].includes(
      (identityMatching as { onNotFound?: unknown }).onNotFound as string,
    )) return null;
    return {
      configVersion: typeof row.config_version === 'number' ? row.config_version : null,
      identityMatching,
      actions,
    };
  } catch {
    // 壊れた計画は無いものとして、現在の設定から作り直す。
    return null;
  }
}

/** 受領行へ固定した実行計画を読む。未保存（旧行・壊れた行）は null。 */
export async function readIncomingWebhookReceiptPlan(
  db: D1Database,
  sourceEventId: string,
): Promise<IncomingWebhookReceiptPlan | null> {
  const row = await db.prepare(`SELECT config_version, identity_match_json, action_refs_json
      FROM incoming_webhook_receipts WHERE source_event_id = ?`)
    .bind(sourceEventId)
    .first<{ config_version: number | null; identity_match_json: string | null; action_refs_json: string | null }>();
  if (!row) return null;
  return parseReceiptPlan(row);
}

/**
 * 受領行へ実行計画を固定する。既に固定済みなら何もしない
 * （先に受領した試行の計画が勝つ。再試行は元の計画を使う）。
 */
export async function saveIncomingWebhookReceiptPlan(
  db: D1Database,
  sourceEventId: string,
  plan: IncomingWebhookReceiptPlan,
): Promise<void> {
  await db.prepare(`UPDATE incoming_webhook_receipts
      SET config_version = ?, identity_match_json = ?, action_refs_json = ?
    WHERE source_event_id = ? AND identity_match_json IS NULL`)
    .bind(
      plan.configVersion,
      JSON.stringify(plan.identityMatching),
      JSON.stringify(plan.actions),
      sourceEventId,
    )
    .run();
}

export function fallbackIncomingWebhookReceiptPlan(): IncomingWebhookReceiptPlan {
  return RECEIPT_PLAN_FALLBACK;
}

export async function stableWebhookStepId(sourceEventId: string, key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([sourceEventId, key]))));
  // LINE retry keys must be UUIDs. A stable version-5-shaped key also survives a lost response.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 受信口ごとの短時間回数制限の条件(#829 N-384)。
 * receipts は受領ごとに1行残るので、回数制限のために新しい表は要らない。
 */
export interface IncomingReceiptRateLimit {
  limit: number;
  windowMs: number;
}

export async function reserveIncomingWebhook(
  db: D1Database, webhookId: string, signatureHash: string, rateLimit: IncomingReceiptRateLimit,
  bodyHash?: string | null,
): Promise<{ kind: 'completed' } | { kind: 'busy' } | { kind: 'rate_limited' }
  | { kind: 'acquired'; execution: IncomingWebhookExecution }> {
  const now = Date.now();
  /*
   * R425: 合言葉の入れ替え後に同じ本文を再署名しても、同じ受領へ結び付ける。
   * 署名は本文だけで作られるため、新旧秘密値では signature_hash が変わる。
   * 本文のハッシュが既知なら新規行を作らず、既存受領の状態に従う
   * （完了→重複、処理中→503、失敗・期限切れ→再開）。
   * 本文が違う正当な通知は別受領のまま。旧行（body_hash NULL）は署名で照合する。
   */
  if (bodyHash) {
    const known = await db.prepare(`SELECT source_event_id,status,received_at,attempt_count
        FROM incoming_webhook_receipts WHERE webhook_id = ? AND body_hash = ?`)
      .bind(webhookId, bodyHash)
      .first<{ source_event_id: string; status: string; received_at: string; attempt_count: number }>();
    if (known) return claimKnownReceipt(db, known, now);
  }
  /*
   * N-384: 受領行の作成に窓内件数の条件を乗せる。件数の確認と行の作成を
   * 1文にすると、並行受信がどちらも「まだ上限内」と読んで上限を超える
   * 隙間がなくなる。上限超えの新規受信は行を残さないので、窓が明けた
   * あとの正規再送を邪魔しない。同じ署名の再送は OR IGNORE で行を増やさず、
   * 既存行の状態(完了→200重複 / 処理中→503 / 失敗・期限切れ→再開)に従う。
   */
  await db.prepare(`INSERT OR IGNORE INTO incoming_webhook_receipts
    (webhook_id,signature_hash,body_hash,source_event_id,received_at)
    SELECT ?,?,?,?,?
    WHERE (SELECT COUNT(*) FROM incoming_webhook_receipts
      WHERE webhook_id=? AND received_at>=?) < ?`)
    .bind(webhookId, signatureHash, bodyHash ?? null, crypto.randomUUID(), new Date(now).toISOString(),
      webhookId, new Date(now - rateLimit.windowMs).toISOString(), rateLimit.limit).run();
  const row = await db.prepare(`SELECT source_event_id,status,received_at,attempt_count FROM incoming_webhook_receipts
    WHERE webhook_id=? AND signature_hash=?`).bind(webhookId, signatureHash)
    .first<{ source_event_id: string; status: string; received_at: string; attempt_count: number }>();
  // 行が無いのは、窓いっぱいで新規受領の INSERT が条件に落ちたときだけ。
  if (!row) return { kind: 'rate_limited' };
  return claimKnownReceipt(db, row, now);
}

type KnownReceiptRow = {
  source_event_id: string;
  status: string;
  received_at: string;
  attempt_count: number;
};

/**
 * 既知の受領行の期限付き所有権を取る。完了ずみは重複、処理中は503、
 * 失敗・期限切れは再開する。署名照合と本文照合（R425）で共有する。
 */
async function claimKnownReceipt(
  db: D1Database,
  row: KnownReceiptRow,
  now: number,
): Promise<{ kind: 'completed' } | { kind: 'busy' } | { kind: 'acquired'; execution: IncomingWebhookExecution }> {
  const owner = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE incoming_webhook_receipts
    SET status='processing',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,last_error_code=NULL
    WHERE source_event_id=? AND (status IN ('accepted','retryable_failed')
      OR (status='processing' AND COALESCE(lease_expires_at,0)<=?))`)
    .bind(owner, now + LEASE_MS, row.source_event_id, now).run();
  const fresh = await db.prepare(`SELECT source_event_id,status,received_at,attempt_count FROM incoming_webhook_receipts
    WHERE source_event_id=?`).bind(row.source_event_id)
    .first<KnownReceiptRow>() ?? row;
  if ((claimed.meta?.changes ?? 0) !== 1) {
    return { kind: fresh.status === 'completed' ? 'completed' : 'busy' };
  }
  const rowRef = fresh;

  const renew = async () => {
    const at = Date.now();
    const result = await db.prepare(`UPDATE incoming_webhook_receipts SET lease_expires_at=?
      WHERE source_event_id=? AND status='processing' AND lease_owner=? AND lease_expires_at>?`)
      .bind(at + LEASE_MS, rowRef.source_event_id, owner, at).run();
    if ((result.meta?.changes ?? 0) !== 1) throw new Error('incoming_receipt_lease_lost');
  };
  return { kind: 'acquired', execution: {
    db: incomingWebhookFencedDb(db, { sourceEventId: rowRef.source_event_id, owner, generation: rowRef.attempt_count }),
    sourceEventId: rowRef.source_event_id,
    occurredAt: rowRef.received_at,
    async step<T>(key: string, work: () => Promise<T>): Promise<T> {
      await renew();
      const previous = await db.prepare(`SELECT result_json FROM incoming_webhook_steps
        WHERE source_event_id=? AND step_key=? AND status='completed'`)
        .bind(rowRef.source_event_id, key).first<{ result_json: string | null }>();
      if (previous) return JSON.parse(previous.result_json ?? 'null') as T;
      await db.prepare(`INSERT OR IGNORE INTO incoming_webhook_steps
        (source_event_id,step_key,status) VALUES (?,?,'processing')`).bind(rowRef.source_event_id, key).run();
      const result = await work();
      await renew();
      const saved = await db.prepare(`UPDATE incoming_webhook_steps SET status='completed',result_json=?
        WHERE source_event_id=? AND step_key=? AND EXISTS (
          SELECT 1 FROM incoming_webhook_receipts WHERE source_event_id=? AND lease_owner=?
            AND status='processing' AND lease_expires_at>?)`)
        .bind(JSON.stringify(result ?? null), rowRef.source_event_id, key, rowRef.source_event_id, owner, Date.now()).run();
      if ((saved.meta?.changes ?? 0) !== 1) throw new Error('incoming_receipt_lease_lost');
      return result;
    },
    async complete() {
      await renew();
      const result = await db.prepare(`UPDATE incoming_webhook_receipts
        SET status='completed',completed_at=?,lease_owner=NULL,lease_expires_at=NULL
        WHERE source_event_id=? AND lease_owner=? AND status='processing'`)
        .bind(new Date().toISOString(), rowRef.source_event_id, owner).run();
      if ((result.meta?.changes ?? 0) !== 1) throw new Error('incoming_receipt_lease_lost');
    },
    async fail() {
      await db.prepare(`UPDATE incoming_webhook_receipts
        SET status='retryable_failed',last_error_code='processing_failed',lease_owner=NULL,lease_expires_at=NULL
        WHERE source_event_id=? AND lease_owner=? AND status='processing'`)
        .bind(rowRef.source_event_id, owner).run();
    },
  } };
}
