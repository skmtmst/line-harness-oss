import { logger } from '@line-crm/shared/server';
import { readCappedBodyText } from './webhook-receive-envelope.js';
import { encryptCredential } from '@line-crm/db';
import { getIncomingWebhookById, resolveWebhookSecret, resolvePreviousWebhookSecret, WEBHOOK_SECRET_MIN_LENGTH as MIN_SECRET_LENGTH, listIntegrationApiTokens, getIntegrationApiTokenById, createIntegrationApiToken, revokeIntegrationApiToken, reactivateIntegrationApiToken, rotateIntegrationApiToken, INTEGRATION_API_SCOPES, type IncomingWebhookIdentityMatch, type IncomingWebhookActionRef } from '@line-crm/db';
import { inputError } from '../lib/input-errors.js';



import type { Env } from '../worker-env.js';
import { sha256Hex } from '../middleware/auth.js';
import { computeHmacSha256Hex, safeEqualHex } from '../lib/hmac.js';
import { stoppedTenantLineAccountSql } from '../services/tenant-runtime-status.js';
import { reserveIncomingWebhook, saveIncomingWebhookReceiptPlan, type IncomingWebhookExecution } from '../services/incoming-webhook-receipts.js';

import { canAccessAllLineAccounts } from '../services/account-access.js';
import { sensitiveStepUpSatisfied, stepUpRequiredResponse } from '../lib/step-up.js';
import { auditLog } from '../lib/audit-log.js';
import { MAX_INCOMING_BODY_BYTES, webhookKeysOf, RECEIVE_RATE_LIMIT, RECEIVE_RATE_WINDOW_MS, safeJson, serializeApiToken, MAX_WEBHOOK_NAME_LENGTH } from './webhooks-definition.js';
import type { Context } from 'hono';

export const post__api_webhooks_incoming_id_receive_1 = async (c: Context<Env, "/api/webhooks/incoming/:id/receive">) => {
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

    const signedTimestamp = c.req.header('X-Webhook-Timestamp') ?? '';
    const signedEventId = c.req.header('X-Webhook-Event-Id') ?? '';
    if (!/^\d{10}$/.test(signedTimestamp) || !/^[A-Za-z0-9_.:-]{8,128}$/.test(signedEventId) || Math.abs(Date.now() - Number(signedTimestamp)*1000) > 300_000) {
      return c.json({success:false, code:'INVALID_FRESHNESS',error:'署名時刻と出来事IDを確認してください'},401);
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
    let expected = await computeHmacSha256Hex(verifySecret, `${signedTimestamp}.${signedEventId}.${rawBody}`);
    if (!safeEqualHex(signatureHeader.toLowerCase(), expected)) {
      const previousSecret = await resolvePreviousWebhookSecret(wh, webhookKeysOf(c));
      if (!previousSecret || previousSecret.length < MIN_SECRET_LENGTH) {
        return c.json({ success: false, error: 'Invalid signature' }, 401);
      }
      const previousExpected = await computeHmacSha256Hex(previousSecret, `${signedTimestamp}.${signedEventId}.${rawBody}`);
      if (!safeEqualHex(signatureHeader.toLowerCase(), previousExpected)) {
        return c.json({ success: false, error: 'Invalid signature' }, 401);
      }
      expected = previousExpected;
      logger.log("incoming_webhook_previous_secret_used");
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

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return inputError(c, { success: false, error: 'Invalid JSON body' }, 400, []);
    }

    /*
     * N-365 (#746): 同じ署名の使い回しを弾く。
     *
     * 時刻・出来事ID・本文を署名し、同じ出来事は受領台帳で1件にまとめる。
     * 期限付き所有権を得た1件だけが下流へ進む。
     * 完了済みなら200、処理中なら再送可能な503、失敗・期限切れなら再開する。
     * 再開時は成功済みの処理を飛ばし、同じイベントIDで下流の重複を防ぐ。
     *
     * 予約は本文を読めたあとに置く。形の壊れた本文で予約を使い切ると、
     * 送り直しが 400 ではなく「重複」になってしまう。
     * 鍵に webhook_id を含めるのは、別の受信口の署名と混ざらないようにするため。
     * 入れるのは署名そのものではなく SHA-256(台帳に使い回せる値を残さない)。
     */
    const signatureHash = await sha256Hex(expected);
    // 合言葉の入れ替え後や時刻を更新した再署名も、同じ出来事IDの受領へ結び付ける。
    // 既存列body_hashには出来事IDのハッシュを保存する（顧客情報は保存しない）。
    const bodyHash = await sha256Hex(signedEventId);
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
      logger.log("incoming_webhook_duplicate_signature");
      return c.json({
        success: true,
        data: { received: true, duplicate: true, source: wh.source_type },
      });
    }
    execution = reserved.execution;

    if (!c.env.LINE_CREDENTIAL_ENCRYPTION_KEY) throw new Error('incoming_queue_encryption_key_missing');
    await saveIncomingWebhookReceiptPlan(c.env.DB, execution.sourceEventId, {
      configVersion: Number(wh.version ?? 1),
      identityMatching: safeJson<IncomingWebhookIdentityMatch>(wh.identity_match_json, {methods:[],onNotFound:'do_nothing'}),
      actions: safeJson<IncomingWebhookActionRef[]>(wh.action_refs_json, []),
    });
    const encrypted = await encryptCredential(JSON.stringify(payload), c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);
    const queuedAt = new Date().toISOString();
    await c.env.DB.prepare(`INSERT OR IGNORE INTO incoming_webhook_queue
      (source_event_id,webhook_id,signature_hash,body_hash,payload_encrypted,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(execution.sourceEventId,wh.id,signatureHash,bodyHash,encrypted,queuedAt,queuedAt,queuedAt).run();
    if(execution.defer) await execution.defer(); else await execution.fail(); // consumer owns the first attempt
    return c.json({success:true,data:{received:true,queued:true,source:wh.source_type}},202);

  } catch (err) {
    if (execution) {
      try { await execution.fail(); } catch { /* The lease lets a later retry recover even during a DB outage. */ }
    }
    logger.error("routes_webhooks_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const get__api_webhooks_api_tokens_2 = async (c: Context<Env, "/api/webhooks/api-tokens">) => {
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
    const includeRevoked = c.req.query('includeRevoked') === '1';
    const items = await listIntegrationApiTokens(c.env.DB, lineAccountId, { includeRevoked });
    return c.json({ success: true, data: items.map(serializeApiToken) });
  } catch (err) {
    logger.error("routes_webhooks_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_webhooks_api_tokens_3 = async (c: Context<Env, "/api/webhooks/api-tokens">) => {
  try {
    // 連携APIトークンの発行は鍵・トークンの操作（V）。
    if (!await sensitiveStepUpSatisfied(c, 'webhook.api_token')) {
      return stepUpRequiredResponse(c, 'APIトークンの発行には本人確認が必要です');
    }
    const body = await c.req.json<{ name?: unknown; scopes?: unknown; lineAccountId?: unknown }>()
      .catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > MAX_WEBHOOK_NAME_LENGTH) {
      return inputError(c, { success: false, error: `name must be 1-${MAX_WEBHOOK_NAME_LENGTH} characters` }, 400, ["name"]);
    }
    if (!Array.isArray(body?.scopes) || body.scopes.length === 0
      || body.scopes.some((scope) => !INTEGRATION_API_SCOPES.includes(scope as never))) {
      return inputError(c, {
        success: false,
        error: `scopes must be a non-empty subset of: ${INTEGRATION_API_SCOPES.join(', ')}`,
      }, 400, ["scopes"]);
    }
    const lineAccountId = typeof body?.lineAccountId === 'string' ? body.lineAccountId.trim() : '';
    if (!lineAccountId) return inputError(c, { success: false, error: 'LINEアカウントを選択してください' }, 400, ["lineAccountId"]);
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
    logger.error("routes_webhooks_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_webhooks_api_tokens_id_revoke_4 = async (c: Context<Env, "/api/webhooks/api-tokens/:id/revoke">) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return inputError(c, { success: false, error: 'LINEアカウントを選択してください' }, 400, ["lineAccountId"]);
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
    logger.error("routes_webhooks_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_webhooks_api_tokens_id_reactivate_5 = async (c: Context<Env, "/api/webhooks/api-tokens/:id/reactivate">) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return inputError(c, { success: false, error: 'LINEアカウントを選択してください' }, 400, ["lineAccountId"]);
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
    logger.error("routes_webhooks_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_webhooks_api_tokens_id_rotate_6 = async (c: Context<Env, "/api/webhooks/api-tokens/:id/rotate">) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return inputError(c, { success: false, error: 'LINEアカウントを選択してください' }, 400, ["lineAccountId"]);
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
    logger.error("routes_webhooks_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};
