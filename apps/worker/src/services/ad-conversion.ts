/**
 * 広告CV送信サービス
 *
 * LINE内アクション発生時に、友だちの広告クリックIDを元に
 * 各広告媒体のConversion APIへオフラインCVを送信する。
 */

import {
  AdConversionLeaseError,
  claimAdConversionSend,
  claimAdConversionOutboxDue,
  enqueueAdConversionOutbox,
  finishAdConversionSend,
  finishAdConversionOutbox,
  getActiveAdPlatforms,
  getAdPlatformById,
  getPinnedAdConversionAccount,
  getRefTrackingWithClickIds,
  takeAdConversionOutboxRow,
  type AdPlatform,
  type AdPlatformConfig,
  type RefTracking,
} from '@line-crm/db';

function clickIdForPlatform(platformName: string, ref: RefTracking): { clickId: string; clickIdType: string } | null {
  switch (platformName) {
    case 'meta': return ref.fbclid ? { clickId: ref.fbclid, clickIdType: 'fbclid' } : null;
    case 'x': return ref.twclid ? { clickId: ref.twclid, clickIdType: 'twclid' } : null;
    case 'google': return ref.gclid ? { clickId: ref.gclid, clickIdType: 'gclid' } : null;
    case 'tiktok': return ref.ttclid ? { clickId: ref.ttclid, clickIdType: 'ttclid' } : null;
    default: return null;
  }
}

/** 通貨ごとの補助単位の桁数。無い通貨は2桁扱い、通貨不明は換算しない。 */
const CURRENCY_MINOR_DIGITS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0,
  USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, CNY: 2, TWD: 2, THB: 2,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};

/** 補助単位(セント等)の金額を媒体へ送る主単位へ直す。通貨不明は触らない。 */
export function toMajorAmount(amount: number, currency?: string | null, amountInMinorUnit?: boolean): number {
  if (!amountInMinorUnit) return amount;
  if (!currency) return amount;
  const digits = CURRENCY_MINOR_DIGITS[currency.toUpperCase()] ?? 2;
  return amount / 10 ** digits;
}

/** 媒体へ送る通貨。来なければ円扱い(従来どおり)。 */
export function toCurrencyCode(currency?: string | null): string {
  return (currency ?? 'JPY').toUpperCase();
}

export async function sendAdConversions(
  db: D1Database,
  friendId: string,
  eventName: string,
  eventValue?: number,
  opts?: {
    idempotencyKey?: string | null; lineAccountId?: string | null; platformId?: string | null;
    /** ISO通貨(例 USD)。無いときは円扱い。 */
    currency?: string | null;
    /** 金額が補助単位(セント等)のとき true。通貨不明のときは換算しない。 */
    amountInMinorUnit?: boolean;
  },
): Promise<void> {
  // 呼び出しをまたいだ重複送信を止める安定キー。無いときは今回限りの鍵にする。
  const idempotencyKey = opts?.idempotencyKey || crypto.randomUUID();
  const hasStableKey = Boolean(opts?.idempotencyKey);

  // 再送時は初回に確保した所属で送る。友だちが移動した後に旧イベントを
  // 新所属へ誤送信しないため。初回は呼び出しの確定分、なければ現所属。
  const friend = await db
    .prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
    .bind(friendId)
    .first<{ line_account_id: string | null }>();
  if (!friend) return;
  const pinned = hasStableKey
    ? await getPinnedAdConversionAccount(db, { friendId, eventName, idempotencyKey })
    : null;
  const lineAccountId = pinned ?? opts?.lineAccountId ?? friend.line_account_id;
  if (!lineAccountId) return;

  // テスト送信など指定があるときはその媒体だけ送る(全媒体に広げない)。
  const platforms = opts?.platformId
    ? (await getActiveAdPlatforms(db, lineAccountId)).filter((p) => p.id === opts.platformId)
    : await getActiveAdPlatforms(db, lineAccountId);

  for (const platform of platforms) {
    // 二重防御: 帰属が違う設定は送らない(DB側でも claim が弾く)。
    if (platform.line_account_id !== lineAccountId) continue;
    // 媒体側の重複排除ID。初回確保時に決めて行に残し、再送・付け替え後も同じ値を使う。
    const providerEventId = hasStableKey ? `${idempotencyKey}:${platform.id}` : crypto.randomUUID();
    // 要求を先に残す。落ちても取り出し側が送る。同じ鍵は初回の1行。
    const outboxId = await enqueueAdConversionOutbox(db, {
      platformId: platform.id, friendId, lineAccountId, eventName,
      eventValue, currency: opts?.currency, amountInMinorUnit: opts?.amountInMinorUnit,
      idempotencyKey, providerEventId,
    });
    const outboxLease = await takeAdConversionOutboxRow(db, outboxId);
    if (!outboxLease) continue; // 他が送り中・送り済み
    await attemptPlatformSend(db, {
      platform, friendId, lineAccountId, eventName,
      eventValue, currency: opts?.currency, amountInMinorUnit: opts?.amountInMinorUnit,
      idempotencyKey, providerEventId,
    }, { id: outboxId, lease: outboxLease });
  }
}

/** 1媒体への送信試行。待ち行列の証を持っていることが前提。 */
async function attemptPlatformSend(
  db: D1Database,
  args: {
    platform: AdPlatform; friendId: string; lineAccountId: string; eventName: string;
    eventValue?: number; currency?: string | null; amountInMinorUnit?: boolean;
    idempotencyKey: string; providerEventId: string;
  },
  outbox: { id: string; lease: string },
): Promise<void> {
  const finishOutbox = (status: 'sent' | 'failed' | 'pending', errorMessage?: string): Promise<void> =>
    finishAdConversionOutbox(db, { id: outbox.id, lease: outbox.lease, status, errorMessage: errorMessage ?? null });

  const ref = await getRefTrackingWithClickIds(db, args.friendId);
  if (!ref) { await finishOutbox('failed', 'ref tracking not found'); return; }
  const click = clickIdForPlatform(args.platform.name, ref);
  if (!click) { await finishOutbox('failed', `no click id for platform: ${args.platform.name}`); return; }
  const config: AdPlatformConfig = JSON.parse(args.platform.config);
  // 金額は主単位・通貨付きに正規化してから確保・送信する。通貨が変われば別内容。
  const currency = toCurrencyCode(args.currency);
  const majorValue = args.eventValue != null ? toMajorAmount(args.eventValue, args.currency, args.amountInMinorUnit) : null;

  const claim = await claimAdConversionSend(db, {
    platformId: args.platform.id, friendId: args.friendId, lineAccountId: args.lineAccountId,
    eventName: args.eventName,
    clickId: click.clickId, clickIdType: click.clickIdType, eventValue: majorValue,
    currency, idempotencyKey: args.idempotencyKey, providerEventId: args.providerEventId,
  });
  if (claim.disposition === 'skip-sent') { await finishOutbox('sent'); return; }
  if (claim.disposition !== 'send' || !claim.lease) {
    // skip-inflightは他が送り中のため戻す。mismatchは同じ内容では送れないため失敗で残す。
    if (claim.disposition === 'mismatch') { await finishOutbox('failed', 'idempotency key content mismatch'); return; }
    await finishOutbox('pending'); return;
  }
  const lease = claim.lease;
  const stableProviderEventId = claim.providerEventId ?? args.providerEventId;
  // 確定は確保証付き。奪われた後の確定は通らず、送り直しは次の再送に任せる。
  const settle = async (status: 'sent' | 'failed', errorMessage?: string): Promise<void> => {
    try {
      await finishAdConversionSend(db, {
        platformId: args.platform.id, friendId: args.friendId, eventName: args.eventName,
        idempotencyKey: args.idempotencyKey, lease,
        status, errorMessage: errorMessage ?? null,
      });
    } catch (settleError) {
      if (!(settleError instanceof AdConversionLeaseError)) throw settleError;
    }
  };
  const markDone = async (status: 'sent' | 'failed', errorMessage?: string): Promise<void> => {
    await settle(status, errorMessage);
    await finishOutbox(status, errorMessage);
  };

  try {
    switch (args.platform.name) {
      case 'meta':
        await sendMetaConversion(config, ref, args.eventName, majorValue ?? undefined, stableProviderEventId, currency);
        break;
      case 'x':
        await sendXConversion(config, ref, args.eventName, majorValue ?? undefined, stableProviderEventId);
        break;
      case 'google':
        await sendGoogleConversion(config, ref, args.eventName, majorValue ?? undefined, stableProviderEventId, currency);
        break;
      case 'tiktok':
        await sendTikTokConversion(config, ref, args.eventName, majorValue ?? undefined, stableProviderEventId, currency);
        break;
      default:
        await markDone('failed', `unsupported platform: ${args.platform.name}`);
        return;
    }
    await markDone('sent');
  } catch (error) {
    await markDone('failed', String(error));
  }
}

/**
 * 送り時が来た待ち行列を取り出して送る。定期実行と手動の両方から呼ぶ。
 * 同じ冪等キーで送るため、生きている送信との二重送信は起きない。
 */
export async function drainAdConversionOutbox(
  db: D1Database,
  opts?: { limit?: number },
): Promise<{ claimed: number; sent: number; failed: number }> {
  const rows = await claimAdConversionOutboxDue(db, { limit: opts?.limit });
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const platform = await getAdPlatformById(db, row.ad_platform_id);
      if (!platform || platform.is_active !== 1 || !row.line_account_id) {
        throw new Error(`platform unavailable: ${row.ad_platform_id}`);
      }
      // 取り出し後に帰属が変わった設定へは送らない。
      if (platform.line_account_id !== row.line_account_id) {
        throw new Error(`platform account changed: ${row.ad_platform_id}`);
      }
      await attemptPlatformSend(db, {
        platform, friendId: row.friend_id, lineAccountId: row.line_account_id,
        eventName: row.event_name, eventValue: row.event_value ?? undefined,
        currency: row.currency, amountInMinorUnit: row.amount_in_minor_unit === 1,
        idempotencyKey: row.idempotency_key,
        providerEventId: row.provider_event_id ?? `${row.idempotency_key}:${row.ad_platform_id}`,
      }, { id: row.id, lease: row.lease_token ?? '' });
      sent++;
    } catch (error) {
      await finishAdConversionOutbox(db, {
        id: row.id, lease: row.lease_token ?? '', status: 'failed', errorMessage: String(error),
      });
      failed++;
    }
  }
  return { claimed: rows.length, sent, failed };
}

async function sendMetaConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
  providerEventId?: string,
  currency = 'JPY',
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${config.pixel_id}/events`;

  const eventData: Record<string, unknown> = {
    event_name: eventName,
    // 媒体側の重複排除ID。再送時は同じIDで送り、二重計上を止める。
    event_id: providerEventId ?? crypto.randomUUID(),
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: {
      fbc: `fb.1.${Date.now()}.${ref.fbclid}`,
      client_ip_address: ref.ip_address || undefined,
      client_user_agent: ref.user_agent || undefined,
    },
  };

  if (eventValue) {
    eventData.custom_data = { currency, value: eventValue };
  }

  const body: Record<string, unknown> = {
    data: [eventData],
    access_token: config.access_token,
  };

  if (config.test_event_code) {
    body.test_event_code = config.test_event_code;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Meta CAPI error: ${response.status} ${errorBody}`);
  }
}

function oauthPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * X Ads API 用の OAuth 1.0a Authorization ヘッダを作る(RFC 5849)。
 * JSON の本文は署名対象に含めない(フォーム形式でないため)。
 */
export async function buildXOAuth1Header(
  method: string,
  url: string,
  credentials: { consumerKey: string; consumerSecret: string; token?: string; tokenSecret?: string },
  opts?: { nonce?: string; timestamp?: string },
): Promise<string> {
  const nonce = opts?.nonce ?? crypto.randomUUID().replaceAll('-', '');
  const timestamp = opts?.timestamp ?? String(Math.floor(Date.now() / 1000));
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_version: '1.0',
  };
  if (credentials.token) oauthParams.oauth_token = credentials.token;

  const sorted = Object.keys(oauthParams).sort()
    .map((key) => `${oauthPercentEncode(key)}=${oauthPercentEncode(oauthParams[key])}`)
    .join('&');
  const baseUrl = url.split('?')[0];
  const baseString = `${method.toUpperCase()}&${oauthPercentEncode(baseUrl)}&${oauthPercentEncode(sorted)}`;
  const signingKey = `${oauthPercentEncode(credentials.consumerSecret)}&${oauthPercentEncode(credentials.tokenSecret ?? '')}`;

  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(signingKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(baseString));
  const signatureBase64 = Buffer.from(signature).toString('base64');

  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signatureBase64 };
  return `OAuth ${Object.keys(headerParams).sort()
    .map((key) => `${oauthPercentEncode(key)}="${oauthPercentEncode(headerParams[key])}"`)
    .join(', ')}`;
}

async function sendXConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
  providerEventId?: string,
): Promise<void> {
  // 資格情報がそろわない媒体へは送らず失敗で残す。署名なしの送信はしない。
  if (!config.api_key || !config.api_secret || !config.x_oauth_token || !config.x_oauth_token_secret) {
    throw new Error('X Conversion API credentials (api_key/api_secret/x_oauth_token/x_oauth_token_secret) are not configured');
  }
  if (!config.pixel_id) {
    throw new Error('X Conversion API pixel_id is not configured');
  }
  if (!config.conversion_id) {
    throw new Error('X Conversion API conversion event ID (conversion_id) is not configured');
  }
  // pixel_id はパスの一部。
  const url = `https://ads-api.x.com/12/measurement/conversions/${encodeURIComponent(config.pixel_id)}`;

  const identifiers: Array<Record<string, string>> = [{ twclid: ref.twclid ?? '' }];
  if (ref.ip_address || ref.user_agent) {
    identifiers.push({
      ...(ref.ip_address ? { ip_address: ref.ip_address } : {}),
      ...(ref.user_agent ? { user_agent: ref.user_agent } : {}),
    });
  }
  const body = {
    conversions: [{
      conversion_time: new Date().toISOString(),
      // Xの項目名は紛らわしい。event_id=管理画面で作った出来事のID、
      // conversion_id=今回の発生ごとの重複排除キー。再試行では同じ鍵で送る。
      event_id: config.conversion_id,
      conversion_id: providerEventId ?? crypto.randomUUID(),
      identifiers,
      // 金額は小数文字列。
      ...(eventValue != null && { value: eventValue.toFixed(2), number_items: 1 }),
    }],
  };

  const authorization = await buildXOAuth1Header('POST', url, {
    consumerKey: config.api_key,
    consumerSecret: config.api_secret,
    token: config.x_oauth_token,
    tokenSecret: config.x_oauth_token_secret,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authorization,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`X Conversion API error: ${response.status} ${errorBody}`);
  }
}

/** Google広告APIの版。上げるときはここだけ変える(v17は廃止済み)。 */
export const GOOGLE_ADS_API_VERSION = 'v25';

/** Googleの発生時刻形式(yyyy-MM-dd HH:mm:ss+09:00)。日本時間の壁時計で送る。 */
export function googleConversionDateTime(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`
    + ` ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`;
}

async function sendGoogleConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
  providerEventId?: string,
  currency = 'JPY',
): Promise<void> {
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${config.customer_id}:uploadClickConversions`;

  const body = {
    conversions: [{
      gclid: ref.gclid,
      conversion_action: `customers/${config.customer_id}/conversionActions/${config.conversion_action_id}`,
      conversion_date_time: googleConversionDateTime(),
      // 再送時の突き合わせ用。安定IDで送り、確定失敗後の重複を抑える。
      ...(providerEventId ? { order_id: providerEventId } : {}),
      ...(eventValue && { conversion_value: eventValue, currency_code: currency }),
    }],
    partial_failure: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.oauth_token}`,
      'developer-token': config.developer_token || '',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Ads API error: ${response.status} ${errorBody}`);
  }
  // HTTP 200 でも conversions 単位の失敗が partialFailureError に入る。見落とさない。
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const partialFailure = payload !== null && typeof payload === 'object'
    ? (payload as { partialFailureError?: unknown }).partialFailureError ?? null
    : null;
  if (partialFailure != null) {
    throw new Error(`Google Ads partial failure: ${JSON.stringify(partialFailure).slice(0, 500)}`);
  }
}

async function sendTikTokConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
  providerEventId?: string,
  currency = 'JPY',
): Promise<void> {
  const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

  const body = {
    pixel_code: config.pixel_code,
    event: eventName,
    // 再試行では同じIDで送り、媒体側の重複計上を止める。
    event_id: providerEventId ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    context: {
      user_agent: ref.user_agent || '',
      ip: ref.ip_address || '',
    },
    properties: {
      ...(ref.ttclid && { ttclid: ref.ttclid }),
      ...(eventValue && { currency, value: eventValue }),
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': config.access_token || '',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`TikTok Events API error: ${response.status} ${errorBody}`);
  }
}
