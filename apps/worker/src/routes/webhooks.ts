import { Hono, type Context } from 'hono';
import {
  getIncomingWebhooks,
  getIncomingWebhookById,
  createIncomingWebhook,
  updateIncomingWebhook,
  deleteIncomingWebhook,
  restoreIncomingWebhook,
  getOutgoingWebhooks,
  getOutgoingWebhookById,
  createOutgoingWebhook,
  updateOutgoingWebhook,
  deleteOutgoingWebhook,
  restoreOutgoingWebhook,
  createWebhookInteraction,
  finishWebhookInteraction,
  getWebhookInteractionById,
  listFailedWebhookInteractionsForRetry,
  countFailedWebhookInteractionsForRetry,
  countExcludedFailedWebhookInteractions,
  countUnverifiedWebhookInteractions,
  listWebhookInteractions,
  getOutgoingWebhookDeliverySummaries,
  updateIncomingWebhookConfig,
  updateIncomingWebhookMaskedSample,
  backfillWebhookSecrets,
  hasWebhookSecret,
  resolveWebhookSecret,
  resolvePreviousWebhookSecret,
  WEBHOOK_SECRET_PREVIOUS_GRACE_MS,
  isKnownOutgoingEventType,
  KNOWN_OUTGOING_EVENT_TYPES,
  WEBHOOK_SECRET_MIN_LENGTH as MIN_SECRET_LENGTH,
  listIncomingWebhookUnmatched,
  countIncomingWebhookUnmatched,
  getIncomingWebhookUnmatchedById,
  resolveIncomingWebhookUnmatched,
  listIntegrationApiTokens,
  getIntegrationApiTokenById,
  createIntegrationApiToken,
  revokeIntegrationApiToken,
  reactivateIntegrationApiToken,
  rotateIntegrationApiToken,
  INTEGRATION_API_SCOPES,
  isOperationCapabilityStopped,
  type IntegrationApiTokenRow,
  type WebhookInteractionRow,
  type WebhookInteractionListRow,
  type IncomingWebhookIdentityMatch,
  type IncomingWebhookActionRef,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { sha256Hex } from '../middleware/auth.js';
import { computeHmacSha256Hex, safeEqualHex } from '../lib/hmac.js';
import { stoppedTenantLineAccountSql } from '../services/tenant-runtime-status.js';
import {
  reserveIncomingWebhook,
  readIncomingWebhookReceiptPlan,
  saveIncomingWebhookReceiptPlan,
  type IncomingWebhookExecution,
  type IncomingWebhookReceiptPlan,
} from '../services/incoming-webhook-receipts.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { sensitiveStepUpSatisfied, stepUpRequiredResponse } from '../lib/step-up.js';
import { auditLog } from '../lib/audit-log.js';
import { maskInteractionPayload } from '../lib/mask-payload.js';
import {
  incomingTestIdempotencyKey,
  retryWebhookInteraction,
  webhookFailureLabel,
  webhookResponseLabel,
  type IncomingTestOutcome,
} from '../services/webhook-interactions.js';
import {
  buildOutgoingWebhookBody,
  deliverOnce,
  failureReasonForDelivery,
} from '../services/outgoing-webhook-delivery.js';
import {
  executeIncomingWebhookActions,
  maskedPayloadShape,
  previewIncomingWebhook,
} from '../services/incoming-webhook-actions.js';

const webhooks = new Hono<Env>();

const MATCH_KINDS = new Set([
  'harness_friend_id', 'external_customer_id', 'verified_email', 'verified_phone',
]);
const NOT_FOUND_ACTIONS = new Set(['do_nothing', 'unmatched_box', 'create_candidate']);
const INCOMING_ACTION_KINDS = new Set([
  'common_action', 'tag', 'friend_field', 'support_mark', 'template', 'scenario',
  'reminder', 'conversion', 'mileage_rule', 'score_rule', 'outgoing_webhook',
  'operator_notification',
]);

/*
 * R404: 受信直後に直接動かせる種類。directAction（incoming-webhook-actions.ts）
 * が組み立てられる5種類と、公開済み版を展開する共通アクションだけ。
 * friend_field・reminder・conversion・mileage_rule・score_rule・
 * operator_notification の直接指定は、保存できても試しも実実行も必ず失敗する
 * ため、保存時点で理由つきで止める（接続済み表示もしない）。
 */
const INCOMING_DIRECTLY_EXECUTABLE_KINDS = new Set([
  'common_action', 'tag', 'support_mark', 'template', 'scenario', 'outgoing_webhook',
]);

const INCOMING_ACTION_KIND_LABELS: Record<string, string> = {
  common_action: '共通アクションを動かす',
  tag: 'タグを付ける',
  friend_field: '友だち情報を更新する',
  support_mark: '対応マークを付ける',
  template: 'テンプレートを送る',
  scenario: 'シナリオを開始する',
  reminder: 'リマインダを開始する',
  conversion: '成果を記録する',
  mileage_rule: 'マイルを付ける',
  score_rule: 'スコアを更新する',
  outgoing_webhook: '別のサービスへ知らせる',
  operator_notification: '担当者へ知らせる',
};

function incomingUnexecutableReason(refKind: string): string | null {
  if (INCOMING_DIRECTLY_EXECUTABLE_KINDS.has(refKind)) return null;
  const label = INCOMING_ACTION_KIND_LABELS[refKind] ?? '保存済みの処理を動かす';
  return `「${label}」は受信直後の処理として直接実行できないため、保存できません。`
    + 'タグを付ける・対応マークを付ける・テンプレートを送る・シナリオを開始する・'
    + '別のサービスへ知らせる・共通アクションを動かす、から選び直してください。';
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 送り先の `event_types` を読む(#506 中)。
 *
 * 1行でも壊れていると一覧全体が例外→500になっていた。壊れた行は空に
 * 落とし、IDを構造化ログに残して一覧は返す。配列でないJSON(文字列など)
 * も同じ扱いにする。
 */
function outgoingEventTypes(raw: string | null | undefined, webhookId: string): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error('event_types is not an array');
    return parsed.map((entry) => String(entry));
  } catch {
    console.error(JSON.stringify({ event: 'outgoing_webhook_event_types_broken', webhookId }));
    return [];
  }
}

async function incomingActionDisplayName(db: D1Database, action: IncomingWebhookActionRef): Promise<string> {
  const table = ({
    common_action: 'common_actions', tag: 'tags', friend_field: 'friend_fields',
    support_mark: 'support_marks', template: 'templates', scenario: 'scenarios',
    reminder: 'reminders', conversion: 'conversion_definitions', outgoing_webhook: 'outgoing_webhooks',
  } as Record<string, string>)[action.refKind];
  if (!table) return '保存済みの設定';
  try {
    // #939 N-368: 送信Webhookの削除は履歴を残す印なので、印のある行は
    // 名づけの参照先としても使わない。他の表に deleted_at は無い。
    const notDeleted = table === 'outgoing_webhooks' ? ' AND deleted_at IS NULL' : '';
    const row = await db.prepare(`SELECT name FROM ${table} WHERE id = ?${notDeleted}`).bind(action.refId).first<{ name: string }>();
    return row?.name?.trim() || '保存済みの設定';
  } catch {
    return '保存済みの設定';
  }
}

function readIncomingConfig(body: unknown):
  | { ok: true; expectedVersion: number; identityMatching: IncomingWebhookIdentityMatch; actions: IncomingWebhookActionRef[] }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'JSON本文が正しくありません' };
  const input = body as Record<string, unknown>;
  const expectedVersion = Number(input.expectedVersion);
  const identity = input.identityMatching as Record<string, unknown> | undefined;
  const methods = identity?.methods;
  const onNotFound = identity?.onNotFound;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, error: 'expectedVersionは1以上の整数で指定してください' };
  }
  if (!Array.isArray(methods) || methods.length > 4 || !NOT_FOUND_ACTIONS.has(String(onNotFound))) {
    return { ok: false, error: '人の照合方法または未照合時の扱いが正しくありません' };
  }
  const normalizedMethods: IncomingWebhookIdentityMatch['methods'] = [];
  const seenKinds = new Set<string>();
  for (const raw of methods) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: '人の照合方法が正しくありません' };
    const item = raw as Record<string, unknown>;
    const kind = String(item.kind);
    const path = typeof item.path === 'string' ? item.path.trim() : '';
    if (!MATCH_KINDS.has(kind) || seenKinds.has(kind)
      || path.length > 200 || !/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])+$/.test(path)) {
      return { ok: false, error: '名前照合は使わず、許可された識別子とJSONPathを指定してください' };
    }
    seenKinds.add(kind);
    normalizedMethods.push({
      kind: kind as IncomingWebhookIdentityMatch['methods'][number]['kind'], path,
    });
  }
  if (!Array.isArray(input.actions) || input.actions.length > 20) {
    return { ok: false, error: '実行処理は20件以内で指定してください' };
  }
  const actions: IncomingWebhookActionRef[] = [];
  for (const raw of input.actions) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: '実行処理が正しくありません' };
    const item = raw as Record<string, unknown>;
    const refKind = String(item.refKind);
    const refId = typeof item.refId === 'string' ? item.refId.trim() : '';
    const refVersionId = item.refVersionId === null || item.refVersionId === undefined
      ? null : typeof item.refVersionId === 'string' ? item.refVersionId.trim() : '';
    if (!INCOMING_ACTION_KINDS.has(refKind) || !refId || refId.length > 200
      || (refVersionId !== null && (!refVersionId || refVersionId.length > 200))) {
      return { ok: false, error: '実行処理は許可された種類と構造化IDで指定してください' };
    }
    // R404: 直接実行できない種類は保存200にしない。試しも実実行も必ず失敗するため。
    const unexecutable = incomingUnexecutableReason(refKind);
    if (unexecutable) return { ok: false, error: unexecutable };
    actions.push({ refKind, refId, refVersionId });
  }
  return {
    ok: true,
    expectedVersion,
    identityMatching: {
      methods: normalizedMethods,
      onNotFound: String(onNotFound) as IncomingWebhookIdentityMatch['onNotFound'],
    },
    actions,
  };
}

/**
 * 送り直しの回数を検証する。
 *
 * #938 以降、再送はリクエスト内の sleep ではなく配送台帳の
 * next_retry_at（1分→5分→30分…の指数待ち）で行う。待ち時間が
 * Worker の実行時間を食わなくなったため、上限は要件26 §6-4 の
 * 送信Webhook上限（最大8試行 = 初回 + 再送7回）にそろえる。
 */
function readMaxRetries(raw: unknown): { ok: true; value: number } | { ok: false } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 7) return { ok: false };
  return { ok: true, value: n };
}


const MAX_WEBHOOK_NAME_LENGTH = 120;
const MAX_EVENT_TYPES = 20;
const MAX_EVENT_TYPE_LENGTH = 100;
// #829 N-384: 受信本文の上限と、受信口ごとの短時間回数制限。
const MAX_INCOMING_BODY_BYTES = 256 * 1024;
const RECEIVE_RATE_LIMIT = 60;
const RECEIVE_RATE_WINDOW_MS = 60_000;
/*
 * R430 (v6-26 §7-1): 署名時刻の受付窓。過去15分・未来5分（時計ずれ分）。
 * 時刻を送ってきた受信だけを検査し、送らない古い送信元は壊さない。
 */
const RECEIVE_TIMESTAMP_PAST_MS = 15 * 60_000;
const RECEIVE_TIMESTAMP_FUTURE_MS = 5 * 60_000;

/*
 * R428: 申告なし・申告不足の本文も上限を超えて読み続けない。
 * 上限を超えたら null を返し、呼び出し側は413にする。
 */
async function readCappedBodyText(raw: Request, maxBytes: number): Promise<string | null> {
  const reader = raw.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // 読み捨ての中断に失敗しても、413 にはできる。
      }
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** R430: X-Webhook-Timestamp の検査状態。送らない受信は checked:false。 */
function receiveTimestampState(raw: string | null | undefined):
  | { checked: false }
  | { checked: true; timeMs: number | null } {
  if (raw === null || raw === undefined || raw.trim() === '') return { checked: false };
  const text = raw.trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return { checked: true, timeMs: numeric >= 1e11 ? numeric : numeric * 1000 };
  }
  const parsed = Date.parse(text);
  return { checked: true, timeMs: Number.isFinite(parsed) ? parsed : null };
}

/**
 * 名前と種別の上限。極端な値で一覧表示が崩れる・DBが膨らむのを防ぐ(#506 軽)。
 */
function validateWebhookName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'name is required';
  if (name.trim().length > MAX_WEBHOOK_NAME_LENGTH) {
    return `name must be ${MAX_WEBHOOK_NAME_LENGTH} characters or less`;
  }
  return null;
}

function validateEventTypes(eventTypes: unknown): string | null {
  if (eventTypes === undefined) return null;
  if (!Array.isArray(eventTypes) || eventTypes.length > MAX_EVENT_TYPES) {
    return `eventTypes must be an array of at most ${MAX_EVENT_TYPES} items`;
  }
  for (const item of eventTypes) {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > MAX_EVENT_TYPE_LENGTH) {
      return `each eventType must be 1-${MAX_EVENT_TYPE_LENGTH} characters`;
    }
    // N-383: 実際に発火する種別だけを受け付ける。誤記や不発パターンは
    // 無音の不達になるため、有効な種別の一覧を添えて拒否する。
    if (!isKnownOutgoingEventType(item.trim())) {
      return `unknown eventType "${item.trim()}". available: ${KNOWN_OUTGOING_EVENT_TYPES.join(', ')}, incoming_webhook.<source_type>, *`;
    }
  }
  return null;
}

function validateSecret(secret: unknown): string | null {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    return `secret must be at least ${MIN_SECRET_LENGTH} characters`;
  }
  return null;
}

function validateHttpsUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return 'url is required';
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'url must be a valid absolute URL';
  }
  if (parsed.protocol !== 'https:') {
    return 'url must use https:// scheme';
  }
  return null;
}

/**
 * 暗号化の鍵がない・壊れているときの保存失敗を見分ける(#650)。
 *
 * secret を平文で書き残さないため、鍵なしの新規・更新は止める。
 * 判定は名前で行う(DB層はモック差し替えのため型では縛らない)。
 */
function isEncryptionKeyError(err: unknown): boolean {
  return err instanceof Error && err.name === 'CredentialEncryptionKeyError';
}

/**
 * 送受信 secret 用の鍵束。現行鍵に加え、併用期間の旧鍵を
 * LINE_CREDENTIAL_PREVIOUS_KEYS(カンマ区切り)で渡せる(#650 再審査)。
 */
function webhookKeysOf(c: Context<Env>): { current?: string; previous?: string } {
  const env = c.env as unknown as Record<string, unknown>;
  const previous = env.LINE_CREDENTIAL_PREVIOUS_KEYS;
  return {
    current: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
    previous: typeof previous === 'string' ? previous : undefined,
  };
}

/**
 * S (#939 機能26): 前の合言葉があといつまで受け付けるか。
 * 併用期間(24時間)を過ぎた・前の値が無い行は null。
 */
function previousSecretUsableUntil(
  row: { secret_previous_encrypted?: string | null; secret_rotated_at?: string | null },
  now = Date.now(),
): string | null {
  if (!row.secret_previous_encrypted || !row.secret_rotated_at) return null;
  const rotatedAt = Date.parse(row.secret_rotated_at);
  if (!Number.isFinite(rotatedAt)) return null;
  const until = rotatedAt + WEBHOOK_SECRET_PREVIOUS_GRACE_MS;
  return until > now ? new Date(until).toISOString() : null;
}



// ========== 受信Webhook ==========

webhooks.get('/api/webhooks/incoming', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    // 詳細口と同じ境界に寄せる(#506 中)。以前は一覧だけ権限キーを見て
    // おらず、権限なし職員が一覧は見られるちぐはぐな状態だった。
    const incomingStaff = c.get('staff');
    if (incomingStaff?.role === 'staff' && !incomingStaff.permissionKeys?.includes('/webhooks')) {
      return c.json({ success: false, error: 'この機能を表示する権限がありません' }, 403);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const items = await getIncomingWebhooks(c.env.DB, lineAccountId);
    return c.json({
      success: true,
      data: items.map((w) => ({
        id: w.id,
        name: w.name,
        sourceType: w.source_type,
        hasSecret: hasWebhookSecret(w),
        isActive: Boolean(w.is_active),
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/webhooks/incoming error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.get('/api/webhooks/incoming/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    const staff = c.get('staff');
    if (staff?.role === 'staff' && !staff.permissionKeys?.includes('/webhooks')) {
      return c.json({ success: false, error: 'この機能を表示する権限がありません' }, 403);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, staff, [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const item = await getIncomingWebhookById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    const identityMatching = safeJson<IncomingWebhookIdentityMatch>(item.identity_match_json, {
      methods: [], onNotFound: 'do_nothing',
    });
    const actions = safeJson<IncomingWebhookActionRef[]>(item.action_refs_json, []);
    const namedActions = await Promise.all(actions.map(async (action) => ({
      ...action,
      displayName: await incomingActionDisplayName(c.env.DB, action),
    })));
    const sample = safeJson<{ fields: Array<{ path: string; type: string; maskedValue: string }>; truncated: boolean } | null>(
      item.latest_masked_sample_json, null,
    );
    // N-367 (#939): 「未照合として確認する」「友だち候補を作る」を選んだ口が
    // 溜めている未確認の件数。箱の中身は /unmatched で見せる。
    const pendingUnmatched = await countIncomingWebhookUnmatched(c.env.DB, item.id, lineAccountId);
    // R404: 既に保存済みの未対応種類は「接続済み」にしない。理由も添える。
    const unexecutableReason = actions
      .map((action) => incomingUnexecutableReason(action.refKind))
      .find((reason): reason is string => reason !== null) ?? null;
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        sourceType: item.source_type,
        hasSecret: hasWebhookSecret(item),
        // S: 入れ替え中なら「前の合言葉が使える期限」。併用期間外は null。
        previousSecretUsableUntil: previousSecretUsableUntil(item),
        isActive: Boolean(item.is_active),
        version: Number(item.version ?? 1),
        identityMatching,
        actions: namedActions,
        pendingUnmatched,
        actionExecution: actions.length === 0
          ? { state: 'not_configured' as const, reason: null }
          : unexecutableReason
            ? { state: 'needs_attention' as const, reason: unexecutableReason }
            : { state: 'connected' as const, reason: null },
        latestSample: sample && item.latest_received_at
          ? { receivedAt: item.latest_received_at, ...sample }
          : null,
        templateFields: sample?.fields.map((field) => ({
          path: field.path,
          type: field.type,
          token: `{{payload${field.path.slice(1)}}}`,
        })) ?? [],
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      },
    });
  } catch {
    console.error(JSON.stringify({
      event: 'incoming_webhook_detail_failed',
      path: c.req.path,
    }));
    return c.json({ success: false, error: '受け取り口の詳細を表示できませんでした' }, 500);
  }
});

webhooks.patch('/api/webhooks/incoming/:id/config', requireRole('owner'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const parsed = readIncomingConfig(await c.req.json<unknown>().catch(() => null));
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const result = await updateIncomingWebhookConfig(c.env.DB, {
      id: c.req.param('id'),
      lineAccountId,
      expectedVersion: parsed.expectedVersion,
      identityMatching: parsed.identityMatching,
      actions: parsed.actions,
    });
    if (result.status === 'not_found') return c.json({ success: false, error: 'Not found' }, 404);
    if (result.status === 'conflict') {
      return c.json({
        success: false,
        code: 'version_conflict',
        error: '受け取り口が更新されています。読み直してください',
        data: { currentVersion: result.currentVersion },
      }, 409);
    }
    auditLog(c, 'webhook.incoming.config.update', { kind: 'incoming_webhook', id: result.item.id });
    return c.json({ success: true, data: { id: result.item.id, version: result.item.version } });
  } catch {
    console.error(JSON.stringify({
      event: 'incoming_webhook_config_update_failed',
      path: c.req.path,
    }));
    return c.json({ success: false, error: '受け取り口の設定を保存できませんでした' }, 500);
  }
});

webhooks.post('/api/webhooks/incoming', requireRole('owner'), async (c) => {
  try {
    // 受信フックの登録は秘密値を扱う大事な操作（V）。
    if (!await sensitiveStepUpSatisfied(c, 'webhook.secret')) {
      return stepUpRequiredResponse(c, '秘密の値の登録には本人確認が必要です');
    }
    const body = await c.req.json<{ name: string; sourceType?: string; secret?: string; lineAccountId: string }>();
    const nameError = validateWebhookName(body.name);
    if (nameError) {
      return c.json({ success: false, error: nameError }, 400);
    }
    const secretError = validateSecret(body.secret);
    if (secretError) {
      return c.json({ success: false, error: secretError }, 400);
    }
    const lineAccountId = body.lineAccountId?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const item = await createIncomingWebhook(c.env.DB, {
      name: body.name,
      sourceType: body.sourceType,
      secret: body.secret as string,
      lineAccountId,
    }, webhookKeysOf(c));
    auditLog(c, 'webhook.incoming.create', { kind: 'incoming_webhook', id: item.id }, { lineAccountId });
    return c.json(
      {
        success: true,
        data: {
          id: item.id,
          name: item.name,
          sourceType: item.source_type,
          // secret is returned exactly once on create so the operator can copy it.
          // Subsequent GETs never expose it. The row itself holds only ciphertext.
          secret: body.secret,
          isActive: Boolean(item.is_active),
          createdAt: item.created_at,
        },
      },
      201,
    );
  } catch (err) {
    if (isEncryptionKeyError(err)) {
      return c.json({ success: false, error: 'secret を安全に保存できませんでした' }, 503);
    }
    console.error('POST /api/webhooks/incoming error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.put('/api/webhooks/incoming/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const existing = await getIncomingWebhookById(c.env.DB, id, lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ name?: string; sourceType?: string; secret?: string; isActive?: boolean }>();
    // 秘密値の入れ替えを伴う更新は鍵・トークンの操作（V）。
    if (body.secret !== undefined && !await sensitiveStepUpSatisfied(c, 'webhook.secret')) {
      return stepUpRequiredResponse(c, '秘密の値の変更には本人確認が必要です');
    }
    if (body.name !== undefined) {
      const nameError = validateWebhookName(body.name);
      if (nameError) {
        return c.json({ success: false, error: nameError }, 400);
      }
    }
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return c.json({ success: false, error: 'isActive must be a boolean' }, 400);
    }
    if (body.secret !== undefined) {
      const secretError = validateSecret(body.secret);
      if (secretError) {
        return c.json({ success: false, error: secretError }, 400);
      }
    }
    // Activation gate: never re-enable a webhook whose post-update secret
    // would still be invalid. Otherwise migration 034 can be bypassed by
    // toggling isActive without touching the legacy null/short secret.
    // Encrypted rows are decrypted for the length check; undecryptable rows
    // stay stopped until the secret is re-entered (#650).
    if (body.isActive === true) {
      let effectiveSecret = body.secret;
      if (effectiveSecret === undefined) {
        try {
          effectiveSecret = await resolveWebhookSecret(existing, webhookKeysOf(c)) ?? undefined;
        } catch {
          return c.json({ success: false, error: 'secret を確認できませんでした。secret を入れ直してください' }, 503);
        }
      }
      if (!effectiveSecret || effectiveSecret.length < MIN_SECRET_LENGTH) {
        return c.json(
          {
            success: false,
            error: `Cannot activate webhook: secret must be at least ${MIN_SECRET_LENGTH} characters. Update the secret first.`,
          },
          400,
        );
      }
    }
    await updateIncomingWebhook(c.env.DB, id, lineAccountId, body, webhookKeysOf(c));
    const updated = await getIncomingWebhookById(c.env.DB, id, lineAccountId);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    // N-379 (#939): 動かす/止める・合言葉の入れ直し・その他の変更を分けて記録する。
    if (body.isActive !== undefined) {
      auditLog(c, body.isActive ? 'webhook.incoming.activate' : 'webhook.incoming.deactivate',
        { kind: 'incoming_webhook', id }, { lineAccountId });
    }
    if (body.secret !== undefined) {
      auditLog(c, 'webhook.incoming.secret.rotate', { kind: 'incoming_webhook', id }, { lineAccountId });
    }
    if (body.name !== undefined || body.sourceType !== undefined) {
      auditLog(c, 'webhook.incoming.update', { kind: 'incoming_webhook', id }, { lineAccountId });
    }
    return c.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        sourceType: updated.source_type,
        hasSecret: hasWebhookSecret(updated),
        previousSecretUsableUntil: previousSecretUsableUntil(updated),
        isActive: Boolean(updated.is_active),
      },
    });
  } catch (err) {
    if (isEncryptionKeyError(err)) {
      return c.json({ success: false, error: 'secret を安全に保存できませんでした' }, 503);
    }
    console.error('PUT /api/webhooks/incoming/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.delete('/api/webhooks/incoming/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const existing = await getIncomingWebhookById(c.env.DB, id, lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteIncomingWebhook(c.env.DB, id, lineAccountId, c.get('staff')?.id);
    auditLog(c, 'webhook.incoming.delete', { kind: 'incoming_webhook', id }, { lineAccountId });
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/webhooks/incoming/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/webhooks/incoming/:id/restore — 削除の取り消し（B 元に戻す）。
 *
 * 消した受信Webhookだけを戻す。戻した直後は止めたまま。消していない
 * 行・無い行・権限の無いアカウントは 404/403。
 */
webhooks.post('/api/webhooks/incoming/:id/restore', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const restored = await restoreIncomingWebhook(c.env.DB, id, lineAccountId);
    if (!restored) return c.json({ success: false, error: 'Not found' }, 404);
    const item = await getIncomingWebhookById(c.env.DB, id, lineAccountId);
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    auditLog(c, 'webhook.incoming.restore', { kind: 'incoming_webhook', id }, { lineAccountId });
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        sourceType: item.source_type,
        hasSecret: hasWebhookSecret(item),
        previousSecretUsableUntil: previousSecretUsableUntil(item),
        isActive: Boolean(item.is_active),
      },
    });
  } catch (err) {
    console.error('POST /api/webhooks/incoming/:id/restore error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 人が見つからなかった届物（#939 N-367） ==========

/**
 * 未照合の箱の中身。届物1件ごとに「照合に使った値」と
 * 「形だけの見本」を返す。生の本文は保存していないので返せない。
 */
webhooks.get('/api/webhooks/incoming/:id/unmatched', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    const staff = c.get('staff');
    if (staff?.role === 'staff' && !staff.permissionKeys?.includes('/webhooks')) {
      return c.json({ success: false, error: 'この機能を表示する権限がありません' }, 403);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, staff, [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const webhook = await getIncomingWebhookById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!webhook) return c.json({ success: false, error: 'Not found' }, 404);
    const status = c.req.query('status');
    const listStatus = status === 'resolved' || status === 'dismissed' ? status : 'pending';
    // R401: 50件超えは limit/offset で辿る。空表示の判定に使う総数も返す。
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '') || 50));
    const offset = Math.max(0, Number(c.req.query('offset') ?? '') || 0);
    const [items, total] = await Promise.all([
      listIncomingWebhookUnmatched(c.env.DB, webhook.id, lineAccountId, listStatus, limit, offset),
      countIncomingWebhookUnmatched(c.env.DB, webhook.id, lineAccountId, listStatus),
    ]);
    /*
     * S: 複数一致で保留した届物は、人が選べるよう候補の友だちを
     * 名前つきで返す。候補に載っていない友だちが選ばれても構わない
     * (運用者が別途確かめた場合を塞がない)。
     */
    const candidateIds = [...new Set(items.flatMap((item) =>
      safeJson<string[]>(item.candidate_friend_ids_json, [])))];
    const candidateNames = new Map<string, string | null>();
    if (candidateIds.length > 0) {
      const placeholders = candidateIds.map(() => '?').join(', ');
      const rows = await c.env.DB.prepare(
        `SELECT id, display_name FROM friends WHERE line_account_id = ? AND id IN (${placeholders})`,
      ).bind(lineAccountId, ...candidateIds).all<{ id: string; display_name: string | null }>();
      for (const row of rows.results ?? []) candidateNames.set(row.id, row.display_name);
    }
    return c.json({
      success: true,
      total,
      data: items.map((item) => {
        const friendIds = item.kind === 'ambiguous'
          ? safeJson<string[]>(item.candidate_friend_ids_json, [])
          : [];
        return {
          id: item.id,
          kind: item.kind,
          status: item.status,
          identityAttempts: safeJson<Array<{ kind: string; path: string; value: string }>>(
            item.identity_attempts_json, [],
          ),
          maskedShape: safeJson<unknown>(item.masked_shape_json, null),
          candidates: friendIds.map((friendId) => ({
            friendId,
            displayName: candidateNames.get(friendId) ?? null,
          })),
          resolvedFriendId: item.resolved_friend_id,
          resolvedAt: item.resolved_at,
          receivedAt: item.received_at,
        };
      }),
    });
  } catch (err) {
    console.error('GET /api/webhooks/incoming/:id/unmatched error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * S (#939 機能26): 受け取りの試し。見本のJSONを照合と行動の組み立てまで
 * 試して結果を返す。届物の受領・行動の実行・箱への記録は一切行わない。
 * 結果だけはやり取り台帳へ「試し」として分けて残す(v6-26 §9)。
 */
webhooks.post('/api/webhooks/incoming/:id/test', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    const staff = c.get('staff');
    if (staff?.role === 'staff' && !staff.permissionKeys?.includes('/webhooks')) {
      return c.json({ success: false, error: 'この機能を表示する権限がありません' }, 403);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, staff, [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const declaredLength = Number(c.req.header('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_INCOMING_BODY_BYTES) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }
    const body = await c.req.json<{ payload?: unknown }>().catch(() => null);
    if (!body || body.payload === undefined) {
      return c.json({ success: false, error: '試すJSONを payload に入れてください' }, 400);
    }
    const webhook = await getIncomingWebhookById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!webhook) return c.json({ success: false, error: 'Not found' }, 404);
    const preview = await previewIncomingWebhook(c.env.DB, {
      lineAccountId,
      payload: body.payload,
      identityMatching: safeJson<IncomingWebhookIdentityMatch>(webhook.identity_match_json, {
        methods: [], onNotFound: 'do_nothing',
      }),
      actions: safeJson<IncomingWebhookActionRef[]>(webhook.action_refs_json, []),
    });
    // 試しの結果はやり取り台帳へ test 種別で分けて残す。本文は残さない。
    // d23d R407: 「試しが終わった」と「照合できた」は別の話。試算の結果を
    // 記録へ残し、一覧で実際の受信の「結びつきました」と見分けが付くようにする。
    const outcome: IncomingTestOutcome = preview.actions.some((action) => !action.ok)
      ? 'invalid'
      : preview.match.status === 'matched'
        ? 'matched'
        : preview.match.status === 'ambiguous'
          ? 'ambiguous'
          : 'not_found';
    const outcomeSummary = {
      matched: '友だちと照合できた',
      ambiguous: '照合候補が複数あった',
      not_found: '照合相手がいなかった',
      invalid: '行動の確認で不備があった',
    }[outcome];
    const started = Date.now();
    try {
      const interaction = await createWebhookInteraction(c.env.DB, {
        lineAccountId,
        direction: 'incoming',
        webhookId: webhook.id,
        webhookName: webhook.name,
        eventType: 'incoming_webhook.test',
        triggerSummary: `${webhook.name}の受け取りを試した・${outcomeSummary}`,
        requestBodyJson: null,
        // 試しは再送しないので冪等キーは使われない。結果の種類を印として残す。
        idempotencyKey: incomingTestIdempotencyKey(outcome),
      });
      await finishWebhookInteraction(c.env.DB, interaction.id, lineAccountId, {
        status: 'succeeded',
        // 相手へ送信しない試しに「相手の応答番号」は存在しない。
        responseStatus: null,
        attemptCount: 1,
        durationMs: Date.now() - started,
      });
    } catch (logError) {
      // 台帳の一時障害で試し自体を止めない。
      console.error('受け取りの試しの記録に失敗:', logError);
    }
    auditLog(c, 'webhook.incoming.test', { kind: 'incoming_webhook', id: webhook.id }, { lineAccountId });
    return c.json({
      success: true,
      data: {
        match: preview.match.status === 'matched'
          ? { status: 'matched' as const, friendId: preview.match.friendId }
          : preview.match.status === 'ambiguous'
            ? { status: 'ambiguous' as const, friendIds: preview.match.friendIds }
            : { status: 'not_found' as const },
        identityAttempts: preview.identityAttempts,
        actions: await Promise.all(preview.actions.map(async (action) => ({
          refIndex: action.refIndex,
          refKind: action.ref.refKind,
          refId: action.ref.refId,
          displayName: await incomingActionDisplayName(c.env.DB, action.ref),
          ok: action.ok,
          plan: action.ok ? action.plan : undefined,
          error: action.ok ? undefined : action.error,
        }))),
      },
    });
  } catch (err) {
    console.error('POST /api/webhooks/incoming/:id/test error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 箱の中の届物を閉じる。`{action:'dismiss'}` は何もしないで閉じる、
 * `{action:'link', friendId}` は既存の友だちに結び付けて閉じる。
 * 友だちの所属はアカウント境界で確かめる。
 */
webhooks.post('/api/webhooks/unmatched/:id/resolve', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const body = await c.req.json<{ action?: unknown; friendId?: unknown }>().catch(() => null);
    const action = body?.action;
    if (action !== 'dismiss' && action !== 'link') {
      return c.json({ success: false, error: 'action は dismiss か link を指定してください' }, 400);
    }
    const item = await getIncomingWebhookUnmatchedById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    let friendId: string | undefined;
    if (action === 'link') {
      if (typeof body?.friendId !== 'string' || !body.friendId.trim()) {
        return c.json({ success: false, error: '結び付ける友だちを指定してください' }, 400);
      }
      friendId = body.friendId.trim();
      const friend = await c.env.DB.prepare(
        'SELECT id FROM friends WHERE id = ? AND line_account_id = ?',
      ).bind(friendId, lineAccountId).first<{ id: string }>();
      if (!friend) return c.json({ success: false, error: 'その友だちはこのLINEアカウントにいません' }, 404);
    }
    const resolved = await resolveIncomingWebhookUnmatched(
      c.env.DB, item.id, lineAccountId,
      action === 'link' ? { action: 'link', friendId: friendId! } : { action: 'dismiss' },
      c.get('staff')?.id,
    );
    if (!resolved) return c.json({ success: false, error: 'すでに処理済みです' }, 409);
    auditLog(c, 'webhook.incoming.unmatched.resolve',
      { kind: 'incoming_webhook_unmatched', id: item.id }, { lineAccountId });
    return c.json({ success: true, data: { id: item.id, status: action === 'link' ? 'resolved' : 'dismissed' } });
  } catch (err) {
    console.error('POST /api/webhooks/unmatched/:id/resolve error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 送信Webhook ==========

webhooks.get('/api/webhooks/outgoing', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    // 受信の詳細口と同じ境界に寄せる(#506 中)。
    const outgoingStaff = c.get('staff');
    if (outgoingStaff?.role === 'staff' && !outgoingStaff.permissionKeys?.includes('/webhooks')) {
      return c.json({ success: false, error: 'この機能を表示する権限がありません' }, 403);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const [items, summaries] = await Promise.all([
      getOutgoingWebhooks(c.env.DB, lineAccountId),
      getOutgoingWebhookDeliverySummaries(c.env.DB, lineAccountId, 30),
    ]);
    const summaryById = new Map(summaries.map((summary) => [summary.webhook_id, summary]));
    return c.json({
      success: true,
      data: items.map((w) => {
        const summary = summaryById.get(w.id);
        const succeeded = Number(summary?.succeeded ?? 0);
        const total = Number(summary?.total ?? 0);
        return {
          id: w.id,
          name: w.name,
          url: w.url,
          eventTypes: outgoingEventTypes(w.event_types, w.id),
          hasSecret: hasWebhookSecret(w),
          isActive: Boolean(w.is_active),
          maxRetries: w.max_retries ?? 0,
          consecutiveFailures: w.consecutive_failures ?? 0,
          lastFailedAt: w.last_failed_at ?? null,
          deliverySummary: {
            periodDays: 30,
            total,
            succeeded,
            failed: Number(summary?.failed ?? 0),
            pending: Number(summary?.pending ?? 0),
            successRate: total > 0 ? Math.round((succeeded / total) * 10_000) / 100 : null,
            lastResult: summary?.last_status ? {
              status: summary.last_status,
              responseStatus: summary.last_response_status,
              completedAt: summary.last_completed_at,
              failureReason: webhookFailureLabel(summary.last_failure_reason),
            } : null,
            canRetry: Boolean(summary?.can_retry),
          },
          createdAt: w.created_at,
          updatedAt: w.updated_at,
        };
      }),
    });
  } catch {
    console.error(JSON.stringify({ event: 'outgoing_webhook_list_failed', path: c.req.path }));
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// N-363 (#939): 編集画面が現在値を読むための詳細口。secret は出さない。
webhooks.get('/api/webhooks/outgoing/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    const staff = c.get('staff');
    if (staff?.role === 'staff' && !staff.permissionKeys?.includes('/webhooks')) {
      return c.json({ success: false, error: 'この機能を表示する権限がありません' }, 403);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, staff, [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const item = await getOutgoingWebhookById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        url: item.url,
        eventTypes: outgoingEventTypes(item.event_types, item.id),
        hasSecret: hasWebhookSecret(item),
        isActive: Boolean(item.is_active),
        maxRetries: item.max_retries ?? 0,
        consecutiveFailures: item.consecutive_failures ?? 0,
        lastFailedAt: item.last_failed_at ?? null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      },
    });
  } catch (err) {
    console.error('GET /api/webhooks/outgoing/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/outgoing', requireRole('owner'), async (c) => {
  try {
    // 送信フックの登録は署名用の秘密値を扱う大事な操作（V）。
    if (!await sensitiveStepUpSatisfied(c, 'webhook.secret')) {
      return stepUpRequiredResponse(c, '秘密の値の登録には本人確認が必要です');
    }
    const body = await c.req.json<{
      name: string;
      url: string;
      eventTypes?: string[];
      secret?: string;
      maxRetries?: unknown;
      lineAccountId: string;
    }>();
    const nameError = validateWebhookName(body.name);
    if (nameError) {
      return c.json({ success: false, error: nameError }, 400);
    }
    const eventTypesError = validateEventTypes(body.eventTypes);
    if (eventTypesError) {
      return c.json({ success: false, error: eventTypesError }, 400);
    }
    const urlError = validateHttpsUrl(body.url);
    if (urlError) {
      return c.json({ success: false, error: urlError }, 400);
    }
    const secretError = validateSecret(body.secret);
    if (secretError) {
      return c.json({ success: false, error: secretError }, 400);
    }
    let maxRetries = 0;
    if (body.maxRetries !== undefined) {
      const parsed = readMaxRetries(body.maxRetries);
      if (!parsed.ok) {
        return c.json({ success: false, error: 'maxRetries must be an integer between 0 and 7' }, 400);
      }
      maxRetries = parsed.value;
    }
    const lineAccountId = body.lineAccountId?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const item = await createOutgoingWebhook(c.env.DB, {
      name: body.name,
      url: body.url,
      eventTypes: (body.eventTypes ?? []).map((item) => item.trim()),
      secret: body.secret as string,
      maxRetries,
      lineAccountId,
    }, webhookKeysOf(c));
    auditLog(c, 'webhook.outgoing.create', { kind: 'outgoing_webhook', id: item.id }, { lineAccountId });
    return c.json(
      {
        success: true,
        data: {
          id: item.id,
          name: item.name,
          url: item.url,
          eventTypes: outgoingEventTypes(item.event_types, item.id),
          // Returned exactly once on create. The row itself holds only ciphertext.
          secret: body.secret,
          isActive: Boolean(item.is_active),
          maxRetries: item.max_retries ?? 0,
          createdAt: item.created_at,
        },
      },
      201,
    );
  } catch (err) {
    if (isEncryptionKeyError(err)) {
      return c.json({ success: false, error: 'secret を安全に保存できませんでした' }, 503);
    }
    console.error('POST /api/webhooks/outgoing error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.put('/api/webhooks/outgoing/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const existing = await getOutgoingWebhookById(c.env.DB, id, lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{
      name?: string;
      url?: string;
      eventTypes?: string[];
      secret?: string;
      isActive?: boolean;
      maxRetries?: unknown;
    }>();
    // 秘密値の入れ替えを伴う更新は鍵・トークンの操作（V）。
    if (body.secret !== undefined && !await sensitiveStepUpSatisfied(c, 'webhook.secret')) {
      return stepUpRequiredResponse(c, '秘密の値の変更には本人確認が必要です');
    }
    // 検証済みの値だけを別に持つ。body をそのまま書き換えると unknown のまま
    // 下流へ渡ることになる。
    let maxRetries: number | undefined;
    if (body.maxRetries !== undefined) {
      const parsed = readMaxRetries(body.maxRetries);
      if (!parsed.ok) {
        return c.json({ success: false, error: 'maxRetries must be an integer between 0 and 7' }, 400);
      }
      maxRetries = parsed.value;
    }
    if (body.name !== undefined) {
      const nameError = validateWebhookName(body.name);
      if (nameError) {
        return c.json({ success: false, error: nameError }, 400);
      }
    }
    const eventTypesError = validateEventTypes(body.eventTypes);
    if (eventTypesError) {
      return c.json({ success: false, error: eventTypesError }, 400);
    }
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return c.json({ success: false, error: 'isActive must be a boolean' }, 400);
    }
    if (body.url !== undefined) {
      const urlError = validateHttpsUrl(body.url);
      if (urlError) {
        return c.json({ success: false, error: urlError }, 400);
      }
    }
    if (body.secret !== undefined) {
      const secretError = validateSecret(body.secret);
      if (secretError) {
        return c.json({ success: false, error: secretError }, 400);
      }
    }
    // Activation gate: a PUT that re-enables an outgoing webhook must leave
    // the row with both a valid secret AND an https url even after the
    // partial update. Without this, migration 034 can be bypassed by
    // sending {isActive:true} on a legacy http:// or secret-less row.
    // Encrypted rows are decrypted for the length check; undecryptable rows
    // stay stopped until the secret is re-entered (#650).
    if (body.isActive === true) {
      let effectiveSecret = body.secret;
      if (effectiveSecret === undefined) {
        try {
          effectiveSecret = await resolveWebhookSecret(existing, webhookKeysOf(c)) ?? undefined;
        } catch {
          return c.json({ success: false, error: 'secret を確認できませんでした。secret を入れ直してください' }, 503);
        }
      }
      const effectiveUrl = body.url ?? existing.url;
      if (!effectiveSecret || effectiveSecret.length < MIN_SECRET_LENGTH) {
        return c.json(
          {
            success: false,
            error: `Cannot activate webhook: secret must be at least ${MIN_SECRET_LENGTH} characters. Update the secret first.`,
          },
          400,
        );
      }
      const urlError = validateHttpsUrl(effectiveUrl);
      if (urlError) {
        return c.json(
          { success: false, error: `Cannot activate webhook: ${urlError}` },
          400,
        );
      }
    }
    await updateOutgoingWebhook(c.env.DB, id, lineAccountId, {
      ...body,
      eventTypes: body.eventTypes?.map((item) => item.trim()),
      maxRetries,
    }, webhookKeysOf(c));
    const updated = await getOutgoingWebhookById(c.env.DB, id, lineAccountId);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    // N-379 (#939): 動かす/止める・合言葉の入れ直し・その他の変更を分けて記録する。
    if (body.isActive !== undefined) {
      auditLog(c, body.isActive ? 'webhook.outgoing.activate' : 'webhook.outgoing.deactivate',
        { kind: 'outgoing_webhook', id }, { lineAccountId });
    }
    if (body.secret !== undefined) {
      auditLog(c, 'webhook.outgoing.secret.rotate', { kind: 'outgoing_webhook', id }, { lineAccountId });
    }
    if (body.name !== undefined || body.url !== undefined
      || body.eventTypes !== undefined || body.maxRetries !== undefined) {
      auditLog(c, 'webhook.outgoing.update', { kind: 'outgoing_webhook', id }, { lineAccountId });
    }
    return c.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        url: updated.url,
        eventTypes: outgoingEventTypes(updated.event_types, updated.id),
        hasSecret: hasWebhookSecret(updated),
        isActive: Boolean(updated.is_active),
        maxRetries: updated.max_retries ?? 0,
        consecutiveFailures: updated.consecutive_failures ?? 0,
        lastFailedAt: updated.last_failed_at ?? null,
      },
    });
  } catch (err) {
    if (isEncryptionKeyError(err)) {
      return c.json({ success: false, error: 'secret を安全に保存できませんでした' }, 503);
    }
    console.error('PUT /api/webhooks/outgoing/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/outgoing/:id/test', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const webhook = await getOutgoingWebhookById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!webhook) return c.json({ success: false, error: 'Not found' }, 404);
    if (!webhook.is_active) return c.json({ success: false, error: '止めている送り先は試せません' }, 409);
    // 緊急停止 (#1050): webhook_outgoing 停止中は試し送信も受け付けない。
    if (await isOperationCapabilityStopped(c.env.DB, lineAccountId, 'webhook_outgoing')) {
      return c.json({ success: false, error: '緊急停止中のため試し送信できません' }, 409);
    }
    // 署名は送信直前に復号した値で付ける。secretが設定済みで読めない
    // (鍵不足・復号失敗)ときだけ送らずに止める(#650)。未設定の旧行は従来どおり試す。
    let sendSecret: string | null = null;
    if (webhook.secret_encrypted || webhook.secret) {
      try {
        sendSecret = await resolveWebhookSecret(webhook, webhookKeysOf(c));
      } catch {
        sendSecret = null;
      }
      if (!sendSecret) {
        return c.json({ success: false, error: 'secret を確認できないため試し送信を止めました' }, 503);
      }
    }
    // N-371: 試し送信も共通封筒で送る。イベントIDと冪等キーは同じ値にし、
    // 記録のやり直しでも同じ出来事として届く。
    const eventId = crypto.randomUUID();
    const body = buildOutgoingWebhookBody({
      eventId,
      eventType: 'webhook.test',
      occurredAt: new Date().toISOString(),
      accountId: lineAccountId,
      data: { test: true, source: 'line-harness-admin' },
      attempt: 1,
    });
    const interaction = await createWebhookInteraction(c.env.DB, {
      lineAccountId, direction: 'outgoing', webhookId: webhook.id, webhookName: webhook.name,
      eventType: 'webhook.test', triggerSummary: '管理画面から1回試した', requestBodyJson: body,
      idempotencyKey: eventId,
    });
    const started = Date.now();
    // d23b R419: 試し送信は1回だけ。画面の案内（届いたかを試す1回）と
    // 自動の送り直しを混ぜないため、送り直しを0回に固定して送る。
    // 署名用の復号は配送側が行う。ここは早い段階で 503 を返すための
    // 事前確認だけに使い、鍵はそのまま渡す(#650 再審査)。
    const result = await deliverOnce(webhook, body, {
      idempotencyKey: eventId,
      credentialKeys: webhookKeysOf(c),
    });
    await finishWebhookInteraction(c.env.DB, interaction.id, lineAccountId, {
      status: result.ok ? 'succeeded' : 'failed',
      responseStatus: result.lastStatus ?? null,
      attemptCount: result.attempts,
      durationMs: Date.now() - started,
      // d23b R410/R415: 他経路と同じ理由を残す。届いたか分からない
      // 失敗を「処理できなかった」と記録しない。
      failureReason: result.ok ? null : failureReasonForDelivery(result),
    });
    auditLog(c, 'webhook.outgoing.test', { kind: 'outgoing_webhook', id: webhook.id }, { lineAccountId });
    return c.json({ success: true, data: { delivered: result.ok, responseStatus: result.lastStatus ?? null } });
  } catch (err) {
    console.error('POST /api/webhooks/outgoing/:id/test error:', err);
    return c.json({ success: false, error: '試し送信に失敗しました' }, 502);
  }
});

webhooks.delete('/api/webhooks/outgoing/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const existing = await getOutgoingWebhookById(c.env.DB, id, lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteOutgoingWebhook(c.env.DB, id, lineAccountId, c.get('staff')?.id);
    auditLog(c, 'webhook.outgoing.delete', { kind: 'outgoing_webhook', id }, { lineAccountId });
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/webhooks/outgoing/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/webhooks/outgoing/:id/restore — 削除の取り消し（B 元に戻す）。
 *
 * 消した送信Webhookだけを戻す。戻した直後は止めたまま。消していない
 * 行・無い行・権限の無いアカウントは 404/403。
 */
webhooks.post('/api/webhooks/outgoing/:id/restore', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const restored = await restoreOutgoingWebhook(c.env.DB, id, lineAccountId);
    if (!restored) return c.json({ success: false, error: 'Not found' }, 404);
    const item = await getOutgoingWebhookById(c.env.DB, id, lineAccountId);
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    auditLog(c, 'webhook.outgoing.restore', { kind: 'outgoing_webhook', id }, { lineAccountId });
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        url: item.url,
        eventTypes: outgoingEventTypes(item.event_types, item.id),
        hasSecret: hasWebhookSecret(item),
        isActive: Boolean(item.is_active),
        maxRetries: item.max_retries ?? 0,
        consecutiveFailures: item.consecutive_failures ?? 0,
        lastFailedAt: item.last_failed_at ?? null,
      },
    });
  } catch (err) {
    console.error('POST /api/webhooks/outgoing/:id/restore error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

function serializeInteraction(row: WebhookInteractionRow) {
  return {
    id: row.id,
    direction: row.direction,
    webhookName: row.webhook_name,
    eventType: row.event_type,
    triggerSummary: row.trigger_summary,
    status: row.status,
    responseLabel: webhookResponseLabel(row),
    responseStatus: row.response_status,
    attemptCount: row.attempt_count,
    durationMs: row.duration_ms,
    failureReason: webhookFailureLabel(row.failure_reason),
    // 判定用の記号も返す(IDEA-26)。'unknown' は無条件に再送せず、
    // 相手先で確かめてからの1件ずつ復旧として画面が扱う。
    failureReasonCode: row.failure_reason,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    retryOfId: row.retry_of_id,
    ...retryBlockFields(row),
  };
}

/**
 * 送り直せるかの判定と、送り直せない理由（d23b R412/R414）。
 * 一覧の行(listWebhookInteractions)には送り先と自動配送の現状が
 * 付いてくる。個別取得の行では分からない分は付けない（隠さず不明のまま）。
 */
function retryBlockFields(row: WebhookInteractionRow) {
  const list = row as Partial<WebhookInteractionListRow>;
  const hasJoin = 'linked_webhook_active' in row;
  const outgoingFailed = row.direction === 'outgoing' && row.status === 'failed';
  // webhook_id が無い記録は連携先が消えたもの。一覧行で送り先が
  // 見つからない（削除印あり含む）ものも同じ扱い。
  const webhookDeleted = row.direction === 'outgoing'
    && (row.webhook_id == null || (hasJoin && list.linked_webhook_active == null));
  const webhookInactive = hasJoin && row.direction === 'outgoing' && list.linked_webhook_active === 0;
  const deliveryStatus = hasJoin ? (list.delivery_status ?? null) : null;
  const autoRetryOpen = deliveryStatus === 'pending' || deliveryStatus === 'sending' || deliveryStatus === 'retry_wait';
  const autoDelivered = deliveryStatus === 'delivered';
  const retryBlockReason =
    webhookDeleted ? 'webhook_deleted'
    : webhookInactive ? 'webhook_inactive'
    : autoRetryOpen ? 'auto_retry_scheduled'
    : autoDelivered ? 'already_delivered'
    : null;
  return {
    // つなぎ先が消えたもの・止まったもの・送った内容が残っていないもの、
    // 自動の送り直しが動いている・届き済みのものは送り直せない。
    canRetry: outgoingFailed && Boolean(row.webhook_id) && row.request_body_json != null
      && !webhookDeleted && !webhookInactive && !autoRetryOpen && !autoDelivered,
    retryBlockReason,
    autoRetryNextAt: autoRetryOpen ? (list.delivery_next_retry_at ?? null) : null,
  };
}

async function requireInteractionAccount(c: Context<Env>) {
  const lineAccountId = c.req.query('lineAccountId')?.trim();
  if (!lineAccountId) return { error: c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400) };
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return { error: c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403) };
  }
  return { lineAccountId };
}

// ========== 送った・受け取ったやり取りの記録 ==========

webhooks.get('/api/webhooks/interactions', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const access = await requireInteractionAccount(c);
    if ('error' in access) return access.error;
    const direction = c.req.query('direction');
    const status = c.req.query('status');
    const result = await listWebhookInteractions(c.env.DB, {
      lineAccountId: access.lineAccountId,
      periodDays: Number(c.req.query('periodDays') ?? 30),
      direction: direction === 'incoming' || direction === 'outgoing' ? direction : undefined,
      status: status === 'succeeded' || status === 'failed' ? status : undefined,
      search: c.req.query('search'),
      page: Number(c.req.query('page') ?? 1),
      limit: Number(c.req.query('limit') ?? 20),
    });
    return c.json({
      success: true,
      data: {
        items: result.items.map(serializeInteraction),
        total: result.total,
        page: result.page,
        limit: result.limit,
        summary: result.summary,
      },
    });
  } catch (err) {
    console.error('GET /api/webhooks/interactions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.get('/api/webhooks/interactions/:id/payload', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const access = await requireInteractionAccount(c);
    if ('error' in access) return access.error;
    const original = await getWebhookInteractionById(c.env.DB, c.req.param('id'), access.lineAccountId);
    if (!original) return c.json({ success: false, error: 'Not found' }, 404);
    // 本文は伏せて返す（F-18）。元やDBは変えない。
    const masked = maskInteractionPayload(original.request_body_json);
    return c.json({
      success: true,
      data: { id: original.id, body: masked.body, available: masked.available },
    });
  } catch (err) {
    console.error('GET /api/webhooks/interactions/:id/payload error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/interactions/:id/retry', requireRole('owner', 'admin'), async (c) => {
  try {
    const access = await requireInteractionAccount(c);
    if ('error' in access) return access.error;
    const original = await getWebhookInteractionById(c.env.DB, c.req.param('id'), access.lineAccountId);
    if (!original) return c.json({ success: false, error: 'Not found' }, 404);
    /*
      IDEA-26: 「届いたか分からない」失敗を無条件で再送しない。
      相手先で同じ処理が記録されていないか確かめた、という運用者の確認
      (confirmed=true)が無い要求は 409 で止める。確認後の再送は同じ
      冪等キーで行うので、届いていても相手先で二重処理されない。
    */
    if (original.failure_reason === 'unknown') {
      let confirmed = false;
      try {
        const body = await c.req.json<{ confirmed?: unknown }>();
        confirmed = body?.confirmed === true;
      } catch {
        confirmed = false;
      }
      if (!confirmed) {
        return c.json({ success: false, error: 'result_unknown_needs_check' }, 409);
      }
    }
    const retried = await retryWebhookInteraction(c.env.DB, original, webhookKeysOf(c));
    auditLog(c, 'webhook.interaction.retry',
      { kind: 'webhook_interaction', id: original.id }, { lineAccountId: access.lineAccountId });
    return c.json({ success: true, data: serializeInteraction(retried) });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'retry_failed';
    if (code === 'not_retryable' || code === 'already_retried') {
      return c.json({ success: false, error: code }, 409);
    }
    /*
      d23b R412: 同じ通知が自動で届き済み・自動の送り直しが動いている
      場合は手動のやり直しを重ねず、理由を画面へ返す。
    */
    if (code === 'already_delivered') {
      return c.json({ success: false, error: code }, 409);
    }
    if (code === 'auto_retry_scheduled') {
      return c.json({ success: false, error: code }, 409);
    }
    if (code === 'webhook_secret_unavailable') {
      return c.json({ success: false, error: 'secret を確認できないため送り直しを止めました' }, 503);
    }
    if (code === 'emergency_stopped') {
      return c.json({ success: false, error: '緊急停止中のため再送できません' }, 409);
    }
    if (code === 'webhook_not_found') return c.json({ success: false, error: code }, 404);
    if (code === 'webhook_inactive' || code === 'payload_unavailable') {
      return c.json({ success: false, error: code }, 400);
    }
    console.error('POST /api/webhooks/interactions/:id/retry error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/interactions/retry-failed', requireRole('owner', 'admin'), async (c) => {
  try {
    const access = await requireInteractionAccount(c);
    if ('error' in access) return access.error;
    // 1件につき最大6回の外部通信になる。1リクエストの外部通信上限を越えないよう5件まで。
    // 結果不明(届いたか分からない)の記録はここには含まれない(IDEA-26)。
    //
    // d23b R405: 選ぶ段階で、送り先が消えた・止まった・内容が残っていない
    // 記録と、自動の送り直しが動いている記録は外す。先頭に固まった対象外の
    // 記録で、後ろの送れる記録へ届かなくなることはなくなった。
    const failed = await listFailedWebhookInteractionsForRetry(c.env.DB, access.lineAccountId, 5);
    // N-387: 対象外に残る件数を先に数えて返す。まとめて操作で黙って残さない。
    const totalFailed = await countFailedWebhookInteractionsForRetry(c.env.DB, access.lineAccountId);
    const remaining = Math.max(0, totalFailed - failed.length);
    // IDEA-26: 結果不明の失敗は無条件に再送しない代わりに、件数を返して
    // 「相手先で確かめてから1件ずつやり直す」ことを画面へ伝える。
    const needsReview = await countUnverifiedWebhookInteractions(c.env.DB, access.lineAccountId);
    // d23b R408: 対象外に残った件数（消えた・止まった送り先、内容が無い
    // 記録、自動の送り直しが動いている記録）も返す。画面が「何件が今回の
    // 対象外だったか」を説明できるようにする。
    const excluded = await countExcludedFailedWebhookInteractions(c.env.DB, access.lineAccountId);
    let succeeded = 0;
    let failedAgain = 0;
    let skipped = 0;
    await Promise.all(failed.map(async (item) => {
      try {
        const result = await retryWebhookInteraction(c.env.DB, item, webhookKeysOf(c));
        if (result.status === 'succeeded') succeeded++;
        else failedAgain++;
      } catch {
        skipped++;
      }
    }));
    if (failed.length > 0) {
      auditLog(c, 'webhook.interaction.retry_failed',
        { kind: 'outgoing_webhook' }, { lineAccountId: access.lineAccountId });
    }
    return c.json({
      success: true,
      data: { requested: failed.length, succeeded, failed: failedAgain, skipped, remaining, needsReview, excluded },
    });
  } catch (err) {
    console.error('POST /api/webhooks/interactions/retry-failed error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== secret の移行(所有者専用) ==========

/**
 * 既存の平文・旧鍵暗号文を現行鍵へ寄せる(#650 再審査)。
 *
 * - dryRun=true(既定)は件数だけ数えて書かない。先にこれで見積もりを取る。
 * - dryRun=false は batchSize 件ずつ移す。べき等なので中断したら呼び直す。
 * - 1行ごとに復号照合してから平文を消す。失敗行は残して報告に積む。
 * - 秘密値は要求にも応答にもログにも出さない。件数と成否だけ返す。
 */
webhooks.post('/api/webhooks/maintenance/secret-backfill', requireRole('owner'), async (c) => {
  try {
    // 秘密値の一括補完は鍵・トークンの操作（V）。
    if (!await sensitiveStepUpSatisfied(c, 'webhook.secret')) {
      return stepUpRequiredResponse(c, '秘密の値の補完には本人確認が必要です');
    }
    const body = await c.req.json<{
      lineAccountId?: string; dryRun?: boolean; batchSize?: unknown;
    }>().catch(() => null);
    const lineAccountId = body?.lineAccountId?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    let batchSize = 50;
    if (body?.batchSize !== undefined) {
      const parsed = Number(body.batchSize);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
        return c.json({ success: false, error: 'batchSize must be an integer between 1 and 500' }, 400);
      }
      batchSize = parsed;
    }
    const report = await backfillWebhookSecrets(c.env.DB, {
      lineAccountId,
      dryRun: body?.dryRun ?? true,
      batchSize,
      keys: webhookKeysOf(c),
    });
    return c.json({ success: true, data: report });
  } catch (err) {
    if (isEncryptionKeyError(err)) {
      return c.json({ success: false, error: 'secret の移行に必要な鍵がありません' }, 503);
    }
    console.error(JSON.stringify({
      event: 'webhook_secret_backfill_failed',
      path: c.req.path,
    }));
    return c.json({ success: false, error: 'secret の移行に失敗しました' }, 500);
  }
});

// ========== 受信Webhookエンドポイント (外部システムからの受信) ==========

webhooks.post('/api/webhooks/incoming/:id/receive', async (c) => {
  let execution: IncomingWebhookExecution | undefined;
  try {
    const id = c.req.param('id');
    const wh = await getIncomingWebhookById(c.env.DB, id);
    if (!wh || !wh.is_active) {
      return c.json({ success: false, error: 'Webhook not found or inactive' }, 404);
    }
    // N-384: 巨大な本文を署名計算の前に止める。申告サイズが超えていれば
    // 読まずに413、申告が無くても実バイト数で止める。
    const declaredLength = Number(c.req.header('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_INCOMING_BODY_BYTES) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }
    // 照合の直前に復号する。鍵不足・復号失敗は fail-closed(#650)。
    let verifySecret: string | null;
    try {
      verifySecret = await resolveWebhookSecret(wh, webhookKeysOf(c));
    } catch {
      verifySecret = null;
    }
    if (!verifySecret || verifySecret.length < MIN_SECRET_LENGTH) {
      // Should never happen post-migration, but fail closed.
      return c.json({ success: false, error: 'Webhook is not configured for secure delivery' }, 503);
    }

    const signatureHeader = c.req.header('X-Webhook-Signature') ?? '';
    if (!signatureHeader) {
      return c.json({ success: false, error: 'X-Webhook-Signature header is required' }, 401);
    }

    // R428: 申告が無くても実バイト数で止める。上限超えは読まずに413。
    const rawBody = await readCappedBodyText(c.req.raw, MAX_INCOMING_BODY_BYTES);
    if (rawBody === null) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }
    /*
     * S (#939 機能26): 合言葉を入れ替えてから24時間は前の合言葉でも
     * 署名が通る。相手のサービス側の切り替えに猶予を持たせるため。
     * 前の合言葉で通した届物はログに残して追えるようにする。
     */
    let expected = await computeHmacSha256Hex(verifySecret, rawBody);
    if (!safeEqualHex(signatureHeader.toLowerCase(), expected)) {
      const previousSecret = await resolvePreviousWebhookSecret(wh, webhookKeysOf(c));
      if (!previousSecret || previousSecret.length < MIN_SECRET_LENGTH) {
        return c.json({ success: false, error: 'Invalid signature' }, 401);
      }
      const previousExpected = await computeHmacSha256Hex(previousSecret, rawBody);
      if (!safeEqualHex(signatureHeader.toLowerCase(), previousExpected)) {
        return c.json({ success: false, error: 'Invalid signature' }, 401);
      }
      expected = previousExpected;
      console.log(JSON.stringify({
        event: 'incoming_webhook_previous_secret_used',
        webhookId: wh.id,
      }));
    }

    /*
     * R427: 署名が通った後、受領の前に契約先の状態を見る。停止・保管が
     * 完了した契約先への新規受信からは外部POSTを1件も起こさない
     * （即時送信と定期再送で同じ停止方針）。署名の前に弾くと停止の有無が
     * 外部へ漏れるため、この順序にする。
     */
    if (wh.line_account_id) {
      const stopped = await c.env.DB.prepare(
        `SELECT 1 AS stopped FROM line_accounts
          WHERE line_accounts.id = ? AND ${stoppedTenantLineAccountSql('line_accounts.id')}`,
      ).bind(wh.line_account_id).first<{ stopped: number }>();
      if (stopped) {
        return c.json({
          success: false,
          error: '契約先が停止中のため受信できません',
          code: 'TENANT_SUSPENDED',
        }, 403);
      }
    }

    /*
     * R430 (v6-26 §7-1): 署名時刻の窓検査。受付期間外の初回受信と
     * 許容幅を超える未来時刻は受領・後続処理なしで拒否する。
     * 時刻を送らない古い送信元は受理する（署名対象への時刻組込みは
     * 将来の送信側契約更新で行う）。
     */
    const timestampState = receiveTimestampState(c.req.header('X-Webhook-Timestamp'));
    if (timestampState.checked) {
      if (timestampState.timeMs === null) {
        return c.json({ success: false, error: 'X-Webhook-Timestamp の形式が正しくありません' }, 400);
      }
      const skew = Date.now() - timestampState.timeMs;
      if (skew > RECEIVE_TIMESTAMP_PAST_MS || skew < -RECEIVE_TIMESTAMP_FUTURE_MS) {
        return c.json({ success: false, error: 'X-Webhook-Timestamp が受付期間外です' }, 401);
      }
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    /*
     * N-365 (#746): 同じ署名の使い回しを弾く。
     *
     * 署名は本文だけで作られているので、盗った署名をそのまま送り直すと
     * 何度でも通っていた。期限付き所有権を得た1件だけが下流へ進む。
     * 完了済みなら200、処理中なら再送可能な503、失敗・期限切れなら再開する。
     * 再開時は成功済みの処理を飛ばし、同じイベントIDで下流の重複を防ぐ。
     *
     * 予約は本文を読めたあとに置く。形の壊れた本文で予約を使い切ると、
     * 送り直しが 400 ではなく「重複」になってしまう。
     * 鍵に webhook_id を含めるのは、別の受信口の署名と混ざらないようにするため。
     * 入れるのは署名そのものではなく SHA-256(台帳に使い回せる値を残さない)。
     */
    const signatureHash = await sha256Hex(expected);
    // R425: 本文のハッシュも残す。合言葉の入れ替え後に同じ通知を再署名しても
    // 同じ受領へ結び付け、受領・未照合・後続通知を重ねない。
    const bodyHash = await sha256Hex(rawBody);
    // N-384: 受領の予約に窓内件数の上限を載せて1文で判定する。
    // 上限超えの新規受信は受領記録を消費せず 429 で返し、
    // 窓が明けたあとの正規再送を残す。
    const reserved = await reserveIncomingWebhook(c.env.DB, wh.id, signatureHash, {
      limit: RECEIVE_RATE_LIMIT,
      windowMs: RECEIVE_RATE_WINDOW_MS,
    }, bodyHash);
    if (reserved.kind === 'rate_limited') {
      c.header('Retry-After', String(Math.ceil(RECEIVE_RATE_WINDOW_MS / 1000)));
      return c.json({ success: false, error: 'Too many requests' }, 429);
    }
    if (reserved.kind === 'busy') {
      c.header('Retry-After', '5');
      return c.json({ success: false, error: 'Webhook processing in progress' }, 503);
    }
    if (reserved.kind === 'completed') {
      console.log(JSON.stringify({
        event: 'incoming_webhook_duplicate_signature',
        webhookId: wh.id,
      }));
      return c.json({
        success: true,
        data: { received: true, duplicate: true, source: wh.source_type },
      });
    }
    execution = reserved.execution;

    if (wh.line_account_id) {
      try {
        await updateIncomingWebhookMaskedSample(
          execution.db,
          wh.id,
          wh.line_account_id,
          maskedPayloadShape(payload),
        );
      } catch {
        console.error(JSON.stringify({
          event: 'incoming_webhook_masked_sample_update_failed',
          webhookId: wh.id,
        }));
      }
    }

    const { fireEvent } = await import('../services/event-bus.js');
    const eventType = `incoming_webhook.${wh.source_type}`;
    const started = Date.now();
    let interaction: Pick<WebhookInteractionRow, 'id'> | null = null;
    if (wh.line_account_id) {
      try {
        interaction = await execution.step('interaction', async () => ({ id: (await createWebhookInteraction(execution!.db, {
          lineAccountId: wh.line_account_id!,
          direction: 'incoming',
          webhookId: wh.id,
          webhookName: wh.name,
          eventType,
          triggerSummary: `${wh.name}から受け取った`,
          // 受信は送り直さないため本文を保管しない。顧客情報を台帳へ複製しない。
          requestBodyJson: null,
        })).id }));
      } catch (logError) {
        // 台帳の一時障害で、署名確認済みの受信処理まで止めない。
        console.error('受信Webhookの記録開始に失敗:', logError);
      }
    }
    let actionResult: { matchedFriendId: string | null; executed: number; failed: number;
      matchStatus: 'matched' | 'not_found' | 'ambiguous' | 'skipped' } =
      { matchedFriendId: null, executed: 0, failed: 0, matchStatus: 'skipped' };
    try {
      /*
       * R402: 受領時に照合方法・未一致時の扱い・処理配列全体・参照版を
       * 一つの実行計画として保存する。再試行はその計画を最後まで使い、
       * 後日の設定変更は新規受信へだけ適用する。既存受信を別計画へ変える
       * 場合は差分と未処理分を明示する（現状は計画の固定のみ行う）。
       */
      let receiptPlan = await readIncomingWebhookReceiptPlan(c.env.DB, execution.sourceEventId);
      if (!receiptPlan) {
        const fresh: IncomingWebhookReceiptPlan = {
          configVersion: typeof wh.version === 'number' ? wh.version : null,
          identityMatching: safeJson<IncomingWebhookIdentityMatch>(wh.identity_match_json, {
            methods: [], onNotFound: 'do_nothing',
          }),
          actions: safeJson<IncomingWebhookActionRef[]>(wh.action_refs_json, []),
        };
        /*
         * 計画の確定は賃借柵の外で行う。内容は受領行の1行に先勝ちで書き、
         * 同じ受領の並行・再試行が上書きしない。柵内の行動実行はこの後。
         */
        await saveIncomingWebhookReceiptPlan(c.env.DB, execution.sourceEventId, fresh);
        receiptPlan = await readIncomingWebhookReceiptPlan(c.env.DB, execution.sourceEventId) ?? fresh;
      }
      if (wh.line_account_id) {
        actionResult = await execution.step('actions', async () => {
          const result = await executeIncomingWebhookActions(execution!.db, {
          lineAccountId: wh.line_account_id!,
          webhookId: wh.id,
          sourceEventId: execution!.sourceEventId,
          payload,
          identityMatching: receiptPlan!.identityMatching,
          actions: receiptPlan!.actions,
          dependencies: { credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY },
          execution,
          });
          if (result.failed > 0) throw new Error('incoming_actions_failed');
          return result;
        });
      }
      await execution.step('event', () => fireEvent(execution!.db, eventType, {
        sourceEventId: execution!.sourceEventId,
        sourceKind: 'incoming_webhook_receipt',
        occurredAt: execution!.occurredAt,
        friendId: actionResult.matchedFriendId ?? undefined,
        eventData: { webhookId: wh.id, source: wh.source_type, payload, actionResult },
      }, undefined, wh.line_account_id ?? null, execution));
      if (actionResult.failed > 0) throw new Error('受信Webhookの処理に失敗しました');
    } catch (eventError) {
      if (interaction && wh.line_account_id) {
        try {
          await finishWebhookInteraction(execution.db, interaction.id, wh.line_account_id, {
            status: 'failed',
            responseStatus: 500,
            attemptCount: 1,
            durationMs: Date.now() - started,
            failureReason: 'processing_failed',
          });
        } catch (logError) {
          console.error('受信Webhookの失敗記録を更新できませんでした:', logError);
        }
      }
      throw eventError;
    }
    if (interaction && wh.line_account_id) {
      try {
        await finishWebhookInteraction(execution.db, interaction.id, wh.line_account_id, {
          status: 'succeeded',
          responseStatus: 200,
          attemptCount: 1,
          durationMs: Date.now() - started,
        });
      } catch (logError) {
        // 受信処理は完了している。台帳の一時障害だけで送信元へ500を返さない。
        console.error('受信Webhookの成功記録を更新できませんでした:', logError);
      }
    }

    await execution.complete();
    return c.json({
      success: true,
      data: {
        received: true,
        source: wh.source_type,
        // N-378: 「受理したが処理対象がいない」を送り主が判別できるよう、
        // 照合結果と実行件数を添える。received:true の契約はそのまま。
        matched: actionResult.matchedFriendId !== null,
        // S: 複数一致で保留になった届物を送り主が判別できるよう照合結果も返す。
        matchStatus: actionResult.matchStatus,
        executed: actionResult.executed,
        failed: actionResult.failed,
      },
    });
  } catch (err) {
    if (execution) {
      try { await execution.fail(); } catch { /* The lease lets a later retry recover even during a DB outage. */ }
    }
    console.error('POST /api/webhooks/incoming/:id/receive error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 公開APIトークン（#939 N-380） ==========
//
// 外部システムが /api/public/v1/* を呼ぶための合言葉。管理画面の認証とは
// 別の台帳で、ここで作ったトークンは公開APIだけに効く。
// 平文は保存しない。発行・再発行の応答にだけ1回だけ乗せる。

function serializeApiToken(row: IntegrationApiTokenRow) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: safeJson<string[]>(row.scopes, []),
    createdBy: row.created_by,
    lastUsedAt: row.last_used_at,
    rotatedFromId: row.rotated_from_id,
    createdAt: row.created_at,
  };
}

webhooks.get('/api/webhooks/api-tokens', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    const staff = c.get('staff');
    if (staff?.role === 'staff' && !staff.permissionKeys?.includes('/webhooks')) {
      return c.json({ success: false, error: 'この機能を表示する権限がありません' }, 403);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, staff, [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const items = await listIntegrationApiTokens(c.env.DB, lineAccountId);
    return c.json({ success: true, data: items.map(serializeApiToken) });
  } catch (err) {
    console.error('GET /api/webhooks/api-tokens error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/api-tokens', requireRole('owner'), async (c) => {
  try {
    // 連携APIトークンの発行は鍵・トークンの操作（V）。
    if (!await sensitiveStepUpSatisfied(c, 'webhook.api_token')) {
      return stepUpRequiredResponse(c, 'APIトークンの発行には本人確認が必要です');
    }
    const body = await c.req.json<{ name?: unknown; scopes?: unknown; lineAccountId?: unknown }>()
      .catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > MAX_WEBHOOK_NAME_LENGTH) {
      return c.json({ success: false, error: `name must be 1-${MAX_WEBHOOK_NAME_LENGTH} characters` }, 400);
    }
    if (!Array.isArray(body?.scopes) || body.scopes.length === 0
      || body.scopes.some((scope) => !INTEGRATION_API_SCOPES.includes(scope as never))) {
      return c.json({
        success: false,
        error: `scopes must be a non-empty subset of: ${INTEGRATION_API_SCOPES.join(', ')}`,
      }, 400);
    }
    const lineAccountId = typeof body?.lineAccountId === 'string' ? body.lineAccountId.trim() : '';
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const { row, token } = await createIntegrationApiToken(c.env.DB, {
      lineAccountId,
      name,
      scopes: body.scopes.map(String),
      createdBy: c.get('staff')?.id,
    });
    auditLog(c, 'webhook.api_token.create', { kind: 'integration_api_token', id: row.id }, { lineAccountId });
    return c.json({
      success: true,
      data: {
        ...serializeApiToken(row),
        // 平文はこの応答の1回だけ。台帳には hash だけが残る。
        token,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/webhooks/api-tokens error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/api-tokens/:id/revoke', requireRole('owner'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const id = c.req.param('id');
    // トークンの失効は鍵・トークンの操作（V）。
    if (!await sensitiveStepUpSatisfied(c, 'webhook.api_token')) {
      return stepUpRequiredResponse(c, 'APIトークンの失効には本人確認が必要です');
    }
    const revoked = await revokeIntegrationApiToken(c.env.DB, id, lineAccountId, c.get('staff')?.id);
    if (!revoked) return c.json({ success: false, error: 'Not found' }, 404);
    auditLog(c, 'webhook.api_token.revoke', { kind: 'integration_api_token', id }, { lineAccountId });
    return c.json({ success: true, data: { id } });
  } catch (err) {
    console.error('POST /api/webhooks/api-tokens/:id/revoke error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/api-tokens/:id/reactivate', requireRole('owner'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const id = c.req.param('id');
    // 止めた鍵を動かし直すのも鍵・トークンの操作（V）。
    if (!await sensitiveStepUpSatisfied(c, 'webhook.api_token')) {
      return stepUpRequiredResponse(c, 'APIトークンの再開には本人確認が必要です');
    }
    const current = await getIntegrationApiTokenById(c.env.DB, id, lineAccountId);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);
    if (current.revoked_at === null) {
      return c.json({ success: false, error: 'このトークンは止められていません' }, 409);
    }
    const reactivated = await reactivateIntegrationApiToken(c.env.DB, id, lineAccountId);
    if (!reactivated) return c.json({ success: false, error: 'Not found' }, 404);
    auditLog(c, 'webhook.api_token.reactivate', { kind: 'integration_api_token', id }, { lineAccountId });
    const row = await getIntegrationApiTokenById(c.env.DB, id, lineAccountId);
    return c.json({ success: true, data: serializeApiToken(row!) });
  } catch (err) {
    console.error('POST /api/webhooks/api-tokens/:id/reactivate error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/api-tokens/:id/rotate', requireRole('owner'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const id = c.req.param('id');
    // トークンの回転は鍵・トークンの操作（V）。
    if (!await sensitiveStepUpSatisfied(c, 'webhook.api_token')) {
      return stepUpRequiredResponse(c, 'APIトークンの再発行には本人確認が必要です');
    }
    const rotated = await rotateIntegrationApiToken(c.env.DB, id, lineAccountId, c.get('staff')?.id);
    if (rotated.status === 'not_found') {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (rotated.status === 'conflict') {
      // 同時再発行に負けた・古い読み取りのまま来た側（R431）。
      // 新トークンは作っていない。一覧を読み直して今の状態から進める。
      const current = await listIntegrationApiTokens(c.env.DB, lineAccountId);
      return c.json({
        success: false,
        code: 'TOKEN_ROTATE_CONFLICT',
        error: 'ほかの操作が先にこのトークンを更新しました。一覧を読み直して、最新の状態からもう一度お試しください',
        tokens: current.map(serializeApiToken),
      }, 409);
    }
    auditLog(c, 'webhook.api_token.rotate', { kind: 'integration_api_token', id: rotated.row.id }, { lineAccountId });
    return c.json({
      success: true,
      data: {
        ...serializeApiToken(rotated.row),
        // 新しい平文はこの応答の1回だけ。旧トークンは即座に使えなくなる。
        token: rotated.token,
      },
    });
  } catch (err) {
    console.error('POST /api/webhooks/api-tokens/:id/rotate error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { webhooks };
