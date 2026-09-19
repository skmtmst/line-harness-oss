import { Hono, type Context } from 'hono';
import {
  getIncomingWebhooks,
  getIncomingWebhookById,
  createIncomingWebhook,
  updateIncomingWebhook,
  deleteIncomingWebhook,
  getOutgoingWebhooks,
  getOutgoingWebhookById,
  createOutgoingWebhook,
  updateOutgoingWebhook,
  deleteOutgoingWebhook,
  createWebhookInteraction,
  finishWebhookInteraction,
  getWebhookInteractionById,
  listFailedWebhookInteractionsForRetry,
  countFailedWebhookInteractionsForRetry,
  listWebhookInteractions,
  getOutgoingWebhookDeliverySummaries,
  updateIncomingWebhookConfig,
  updateIncomingWebhookMaskedSample,
  backfillWebhookSecrets,
  hasWebhookSecret,
  resolveWebhookSecret,
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
  rotateIntegrationApiToken,
  INTEGRATION_API_SCOPES,
  type IntegrationApiTokenRow,
  type WebhookInteractionRow,
  type IncomingWebhookIdentityMatch,
  type IncomingWebhookActionRef,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { sha256Hex } from '../middleware/auth.js';
import { computeHmacSha256Hex, safeEqualHex } from '../lib/hmac.js';
import { reserveIncomingWebhook, type IncomingWebhookExecution } from '../services/incoming-webhook-receipts.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { auditLog } from '../lib/audit-log.js';
import {
  retryWebhookInteraction,
  webhookFailureLabel,
  webhookResponseLabel,
} from '../services/webhook-interactions.js';
import { buildOutgoingWebhookBody, deliverWebhook } from '../services/outgoing-webhook-delivery.js';
import { executeIncomingWebhookActions, maskedPayloadShape } from '../services/incoming-webhook-actions.js';

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
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        sourceType: item.source_type,
        hasSecret: hasWebhookSecret(item),
        isActive: Boolean(item.is_active),
        version: Number(item.version ?? 1),
        identityMatching,
        actions: namedActions,
        pendingUnmatched,
        actionExecution: {
          state: actions.length > 0 ? 'connected' : 'not_configured',
          reason: null,
        },
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
    const items = await listIncomingWebhookUnmatched(
      c.env.DB, webhook.id, lineAccountId,
      status === 'resolved' || status === 'dismissed' ? status : 'pending',
    );
    return c.json({
      success: true,
      data: items.map((item) => ({
        id: item.id,
        kind: item.kind,
        status: item.status,
        identityAttempts: safeJson<Array<{ kind: string; path: string; value: string }>>(
          item.identity_attempts_json, [],
        ),
        maskedShape: safeJson<unknown>(item.masked_shape_json, null),
        resolvedFriendId: item.resolved_friend_id,
        resolvedAt: item.resolved_at,
        receivedAt: item.received_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/webhooks/incoming/:id/unmatched error:', err);
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
    // 署名用の復号は deliverWebhook が行う。ここは早い段階で 503 を返すための
    // 事前確認だけに使い、鍵はそのまま渡す(#650 再審査)。
    const result = await deliverWebhook(webhook, body, {
      idempotencyKey: eventId,
      credentialKeys: webhookKeysOf(c),
    });
    await finishWebhookInteraction(c.env.DB, interaction.id, lineAccountId, {
      status: result.ok ? 'succeeded' : 'failed',
      responseStatus: result.lastStatus ?? null,
      attemptCount: result.attempts,
      durationMs: Date.now() - started,
      failureReason: result.ok ? null : 'processing_failed',
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
    canRetry: row.direction === 'outgoing' && row.status === 'failed' && Boolean(row.webhook_id),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    retryOfId: row.retry_of_id,
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

webhooks.post('/api/webhooks/interactions/:id/retry', requireRole('owner', 'admin'), async (c) => {
  try {
    const access = await requireInteractionAccount(c);
    if ('error' in access) return access.error;
    const original = await getWebhookInteractionById(c.env.DB, c.req.param('id'), access.lineAccountId);
    if (!original) return c.json({ success: false, error: 'Not found' }, 404);
    const retried = await retryWebhookInteraction(c.env.DB, original, webhookKeysOf(c));
    auditLog(c, 'webhook.interaction.retry',
      { kind: 'webhook_interaction', id: original.id }, { lineAccountId: access.lineAccountId });
    return c.json({ success: true, data: serializeInteraction(retried) });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'retry_failed';
    if (code === 'not_retryable' || code === 'already_retried') {
      return c.json({ success: false, error: code }, 409);
    }
    if (code === 'webhook_secret_unavailable') {
      return c.json({ success: false, error: 'secret を確認できないため送り直しを止めました' }, 503);
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
    const failed = await listFailedWebhookInteractionsForRetry(c.env.DB, access.lineAccountId, 5);
    // N-387: 対象外に残る件数を先に数えて返す。まとめて操作で黙って残さない。
    const totalFailed = await countFailedWebhookInteractionsForRetry(c.env.DB, access.lineAccountId);
    const remaining = Math.max(0, totalFailed - failed.length);
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
      data: { requested: failed.length, succeeded, failed: failedAgain, skipped, remaining },
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

    const rawBody = await c.req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_INCOMING_BODY_BYTES) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }
    const expected = await computeHmacSha256Hex(verifySecret, rawBody);
    if (!safeEqualHex(signatureHeader.toLowerCase(), expected)) {
      return c.json({ success: false, error: 'Invalid signature' }, 401);
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
    // N-384: 受領の予約に窓内件数の上限を載せて1文で判定する。
    // 上限超えの新規受信は受領記録を消費せず 429 で返し、
    // 窓が明けたあとの正規再送を残す。
    const reserved = await reserveIncomingWebhook(c.env.DB, wh.id, signatureHash, {
      limit: RECEIVE_RATE_LIMIT,
      windowMs: RECEIVE_RATE_WINDOW_MS,
    });
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
    let actionResult: { matchedFriendId: string | null; executed: number; failed: number } =
      { matchedFriendId: null, executed: 0, failed: 0 };
    try {
      const identityMatching = safeJson<IncomingWebhookIdentityMatch>(wh.identity_match_json, {
        methods: [], onNotFound: 'do_nothing',
      });
      const configuredActions = safeJson<IncomingWebhookActionRef[]>(wh.action_refs_json, []);
      if (wh.line_account_id) {
        actionResult = await execution.step('actions', async () => {
          const result = await executeIncomingWebhookActions(execution!.db, {
          lineAccountId: wh.line_account_id!,
          webhookId: wh.id,
          sourceEventId: execution!.sourceEventId,
          payload,
          identityMatching,
          actions: configuredActions,
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
    const revoked = await revokeIntegrationApiToken(c.env.DB, id, lineAccountId, c.get('staff')?.id);
    if (!revoked) return c.json({ success: false, error: 'Not found' }, 404);
    auditLog(c, 'webhook.api_token.revoke', { kind: 'integration_api_token', id }, { lineAccountId });
    return c.json({ success: true, data: { id } });
  } catch (err) {
    console.error('POST /api/webhooks/api-tokens/:id/revoke error:', err);
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
    const rotated = await rotateIntegrationApiToken(c.env.DB, id, lineAccountId, c.get('staff')?.id);
    if (!rotated) return c.json({ success: false, error: 'Not found' }, 404);
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
