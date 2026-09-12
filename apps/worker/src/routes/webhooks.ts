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
  listWebhookInteractions,
  getOutgoingWebhookDeliverySummaries,
  updateIncomingWebhookConfig,
  updateIncomingWebhookMaskedSample,
  backfillWebhookSecrets,
  hasWebhookSecret,
  resolveWebhookSecret,
  WEBHOOK_SECRET_MIN_LENGTH as MIN_SECRET_LENGTH,
  type WebhookInteractionRow,
  type IncomingWebhookIdentityMatch,
  type IncomingWebhookActionRef,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { sha256Hex } from '../middleware/auth.js';
import { reserveIncomingWebhook, type IncomingWebhookExecution } from '../services/incoming-webhook-receipts.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import {
  retryWebhookInteraction,
  webhookFailureLabel,
  webhookResponseLabel,
} from '../services/webhook-interactions.js';
import { deliverWebhook } from '../services/outgoing-webhook-delivery.js';
import { executeIncomingWebhookActions } from '../services/incoming-webhook-actions.js';

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
    const row = await db.prepare(`SELECT name FROM ${table} WHERE id = ?`).bind(action.refId).first<{ name: string }>();
    return row?.name?.trim() || '保存済みの設定';
  } catch {
    return '保存済みの設定';
  }
}

function jsonPathSegment(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function maskedPayloadShape(payload: unknown) {
  const fields: Array<{ path: string; type: string; maskedValue: '••••' }> = [];
  let truncated = false;
  const visit = (value: unknown, path: string, depth: number) => {
    if (fields.length >= 50) {
      truncated = true;
      return;
    }
    if (depth >= 6 || value === null || typeof value !== 'object') {
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      fields.push({ path, type, maskedValue: '••••' });
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) fields.push({ path, type: 'array', maskedValue: '••••' });
      else visit(value[0], `${path}[0]`, depth + 1);
      return;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) fields.push({ path, type: 'object', maskedValue: '••••' });
    for (const [key, child] of entries) visit(child, `${path}${jsonPathSegment(key)}`, depth + 1);
  };
  visit(payload, '$', 0);
  return { fields, truncated };
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
 * 上限を5にしているのは、待ち時間を倍にしていくと6回目以降は
 * Worker の実行時間に収まらなくなるため。相手が長時間落ちている場合まで
 * 面倒を見るなら、キューに積む別の設計が要る。
 */
function readMaxRetries(raw: unknown): { ok: true; value: number } | { ok: false } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 5) return { ok: false };
  return { ok: true, value: n };
}


const MAX_WEBHOOK_NAME_LENGTH = 120;
const MAX_EVENT_TYPES = 20;
const MAX_EVENT_TYPE_LENGTH = 100;

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

// Constant-time hex-string compare to avoid timing oracles.
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function computeHmacSha256Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
    await deleteIncomingWebhook(c.env.DB, id, lineAccountId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/webhooks/incoming/:id error:', err);
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
        return c.json({ success: false, error: 'maxRetries must be an integer between 0 and 5' }, 400);
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
      eventTypes: body.eventTypes ?? [],
      secret: body.secret as string,
      maxRetries,
      lineAccountId,
    }, webhookKeysOf(c));
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
        return c.json({ success: false, error: 'maxRetries must be an integer between 0 and 5' }, 400);
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
    await updateOutgoingWebhook(c.env.DB, id, lineAccountId, { ...body, maxRetries }, webhookKeysOf(c));
    const updated = await getOutgoingWebhookById(c.env.DB, id, lineAccountId);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
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
    const body = JSON.stringify({
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: { test: true, source: 'line-harness-admin' },
    });
    const interaction = await createWebhookInteraction(c.env.DB, {
      lineAccountId, direction: 'outgoing', webhookId: webhook.id, webhookName: webhook.name,
      eventType: 'webhook.test', triggerSummary: '管理画面から1回試した', requestBodyJson: body,
    });
    const started = Date.now();
    // 署名用の復号は deliverWebhook が行う。ここは早い段階で 503 を返すための
    // 事前確認だけに使い、鍵はそのまま渡す(#650 再審査)。
    const result = await deliverWebhook(webhook, body, {
      idempotencyKey: interaction.id,
      credentialKeys: webhookKeysOf(c),
    });
    await finishWebhookInteraction(c.env.DB, interaction.id, lineAccountId, {
      status: result.ok ? 'succeeded' : 'failed',
      responseStatus: result.lastStatus ?? null,
      attemptCount: result.attempts,
      durationMs: Date.now() - started,
      failureReason: result.ok ? null : 'processing_failed',
    });
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
    await deleteOutgoingWebhook(c.env.DB, id, lineAccountId);
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
    return c.json({
      success: true,
      data: { requested: failed.length, succeeded, failed: failedAgain, skipped },
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
    const reserved = await reserveIncomingWebhook(c.env.DB, wh.id, signatureHash);
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
    try {
      const identityMatching = safeJson<IncomingWebhookIdentityMatch>(wh.identity_match_json, {
        methods: [], onNotFound: 'do_nothing',
      });
      const configuredActions = safeJson<IncomingWebhookActionRef[]>(wh.action_refs_json, []);
      const actionResult = wh.line_account_id
        ? await execution.step('actions', async () => {
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
        })
        : { matchedFriendId: null, executed: 0, failed: 0 };
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
    return c.json({ success: true, data: { received: true, source: wh.source_type } });
  } catch (err) {
    if (execution) {
      try { await execution.fail(); } catch { /* The lease lets a later retry recover even during a DB outage. */ }
    }
    console.error('POST /api/webhooks/incoming/:id/receive error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { webhooks };
