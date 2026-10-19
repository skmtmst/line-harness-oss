import { jstCalendar as japanCalendar } from '@line-crm/shared';
import { logger } from '@line-crm/shared/server';
import { workflowLineClient } from '../services/workflow-line-client.js';

import { verifySignature, LineClient } from '@line-crm/line-sdk';
import type { WebhookRequestBody } from '@line-crm/line-sdk';
import { listLineAccountsWithTenantStatus } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { processLineWebhookEvents } from '../services/line-webhook-events.js';
import { MAX_WEBHOOK_BODY_SIZE, handleStoppedTenantEvent, handleNoticeLinkCode, handleEvent } from './webhook-definition.js';
import type { Context } from 'hono';

export const post__webhook_1 = async (c: Context<Env>) => {
  // Pre-read size guard: reject before reading the body if Content-Length is oversized.
  const contentLengthHeader = c.req.header('Content-Length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_SIZE) {
      return c.json({ status: 'too_large' }, 413);
    }
  }

  const rawBody = await c.req.text();

  // Post-read size guard for the case where Content-Length was absent or untrustworthy.
  // Use UTF-8 byte count: `rawBody.length` counts UTF-16 code units, so multibyte
  // payloads (Japanese/emoji) would otherwise bypass the cap.
  const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
  if (rawBodyByteLength > MAX_WEBHOOK_BODY_SIZE) {
    return c.json({ status: 'too_large' }, 413);
  }

  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  // Cheap pre-reject for unsigned / malformed-signature requests. LINE signatures
  // are HMAC-SHA256 + base64 = 44 chars. This avoids D1 lookups and HMAC compute
  // for junk traffic on a public endpoint.
  const LINE_SIGNATURE_LENGTH = 44;
  if (signature.length !== LINE_SIGNATURE_LENGTH) {
    logger.error("Missing_or_malformed_LINE_signature");
    return c.json({ status: 'ok' }, 200);
  }

  // A URL selects a candidate, never authorizes it. Legacy URLs must have
  // exactly one signature match; never pick the first of ambiguous credentials.
  const channelId = c.req.param('channelId');
  if (channelId !== undefined && !/^\d+$/.test(channelId)) return c.json({ status: 'ok' }, 200);
  const accounts = await listLineAccountsWithTenantStatus(db, undefined, channelId);
  let matched: (typeof accounts)[number] | undefined;
  for (const account of accounts) {
    if (channelId !== undefined && account.channel_id !== channelId) continue;
    if (!account.channel_secret || !await verifySignature(account.channel_secret, rawBody, signature)) continue;
    if (matched) {
      logger.error('line_webhook_ambiguous_account');
      return c.json({ status: 'ok' }, 200);
    }
    matched = account;
  }
  if (!matched || !matched.is_active || matched.archived_at) return c.json({ status: 'ok' }, 200);
  const matchedAccountId = matched.id;
  const channelAccessToken = matched.channel_access_token;
  const matchedTenantStatus = matched.tenant_status;
  if (!channelAccessToken) return c.json({ status: 'ok' }, 200);

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    return c.json({ status: 'ok' }, 200);
  }
  if (!body || typeof body.destination !== 'string' || !body.destination || !Array.isArray(body.events)) {
    return c.json({ status: 'ok' }, 200);
  }

  // 届いた時刻を覚える。届かない警告（X-2）の判定に使う。
  if (matchedAccountId) {
    try {
      await db
        .prepare(`UPDATE line_accounts SET last_webhook_received_at = ? WHERE id = ?`)
        .bind(japanCalendar().toISOString().slice(0, -1) + '+09:00', matchedAccountId)
        .run();
    } catch (stampError) {
      logger.error("routes_webhook_failed");
    }
  }

  const lineClient = new LineClient(channelAccessToken);
  // The sender knows its own secret and can sign arbitrary destination values.
  // Persistence must therefore use the authenticated DB identity, not payload data.
  const lineMessageAccountKey = `account:${matchedAccountId}`;
  const legacyLineMessageAccountKey = `destination:${body.destination}`;

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = processLineWebhookEvents({
    db,
    events: body.events,
    lineAccountId: matchedAccountId,
    handle: async (event, execution) => {
      const ownedClient=workflowLineClient(lineClient,execution);
      if (matchedTenantStatus !== 'active') {
        return handleStoppedTenantEvent(
          execution.mutationDb('stopped_tenant'),
          ownedClient,
          event,
          matchedAccountId,
          lineMessageAccountKey,
          legacyLineMessageAccountKey,
        );
      }
      // 契約者専用LINE（★37-7）: 6 桁の確認コードなら権限者の紐づけとして受ける。
      // 対象アカウント以外・コード以外は何もしないので、店舗のアカウントには影響しない。
      if (await handleNoticeLinkCode(c.env, execution.mutationDb('notice_code'), ownedClient, event, matchedAccountId)) return;
      return handleEvent(
      execution.db,
      ownedClient,
      event,
      channelAccessToken,
      matchedAccountId,
      lineMessageAccountKey,
      c.env.WORKER_URL || new URL(c.req.url).origin,
      c.env.LIFF_URL,
      c.env.IMAGES,
      c.env.NEN_EC_BASE_URL && c.env.ECCUBE_WEBHOOK_SECRET
        ? { baseUrl: c.env.NEN_EC_BASE_URL, secret: c.env.ECCUBE_WEBHOOK_SECRET }
        : undefined,
      c.env,
      execution,
      legacyLineMessageAccountKey,
      );
    },
  });

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
};
