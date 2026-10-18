import { workflowLineClient } from '../services/workflow-line-client.js';

import { verifySignature, LineClient } from '@line-crm/line-sdk';
import type { WebhookRequestBody } from '@line-crm/line-sdk';
import { listLineAccountsWithTenantStatus } from '@line-crm/db';
import type { Env } from '../index.js';
import { processLineWebhookEvents } from '../services/line-webhook-events.js';
import { MAX_WEBHOOK_BODY_SIZE, handleStoppedTenantEvent, handleNoticeLinkCode, handleEvent } from './webhook-definition.js';
import type { Context } from 'hono';

export const post__webhook_1 = async (c: Context<Env, "/webhook">) => {
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
    console.error('Missing or malformed LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  // Verify signature BEFORE JSON.parse so attacker-controlled bodies never reach the parser.
  // Fast path: try env default secret first so malformed/unauthenticated traffic
  //   fails fast without a D1 lookup. The main account is typically also registered
  //   in line_accounts; on env match we still look it up so matchedAccountId binds
  //   correctly for downstream account-scoped filters.
  // Slow path: iterate DB-registered accounts for genuinely multi-account installs.
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;
  let matchedTenantStatus: 'active' | 'suspended' | 'archived' = 'active';
  let valid = false;

  const envSecret = c.env.LINE_CHANNEL_SECRET;
  if (envSecret) {
    valid = await verifySignature(envSecret, rawBody, signature);
    if (valid) {
      const accounts = await listLineAccountsWithTenantStatus(db);
      const main = accounts.find(
        (a) => a.is_active && !a.archived_at && a.channel_secret === envSecret,
      );
      if (main) {
        channelAccessToken = main.channel_access_token;
        matchedAccountId = main.id;
        matchedTenantStatus = main.tenant_status ?? 'active';
      }
    }
  }

  if (!valid) {
    const accounts = await listLineAccountsWithTenantStatus(db);
    for (const account of accounts) {
      if (!account.is_active || account.archived_at) continue;
      if (envSecret && account.channel_secret === envSecret) continue; // already tried via fast path
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        matchedTenantStatus = account.tenant_status ?? 'active';
        valid = true;
        break;
      }
    }
  }

  if (!valid) {
    console.error('Invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  // 署名だけでは店の所属を証明できない。解決不能な受信は副作用を起こさない。
  if (!matchedAccountId) return c.json({ status: 'ok' }, 200);

  // 届いた時刻を覚える。届かない警告（X-2）の判定に使う。
  if (matchedAccountId) {
    try {
      await db
        .prepare(`UPDATE line_accounts SET last_webhook_received_at = ? WHERE id = ?`)
        .bind(new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, -1) + '+09:00', matchedAccountId)
        .run();
    } catch (stampError) {
      console.error(JSON.stringify({"code":"routes_webhook_failed","route":"POST /webhook"}));
    }
  }

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);
  // LINEのdestinationは公式アカウントごとに安定している。DBアカウントの
  // 解決前後でキーを変えると、先着した取消墓標と後着messageが分断される。
  const lineMessageAccountKey = `destination:${body.destination}`;

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
        );
      }
      // 契約者専用LINE（★V6 37-7）: 6 桁の確認コードなら権限者の紐づけとして受ける。
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
      );
    },
  });

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
};
