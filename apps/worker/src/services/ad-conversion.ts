/**
 * 広告CV送信サービス
 *
 * LINE内アクション発生時に、友だちの広告クリックIDを元に
 * 各広告媒体のConversion APIへオフラインCVを送信する。
 */

import {
  claimAdConversionSend,
  finishAdConversionSend,
  getActiveAdPlatforms,
  getPinnedAdConversionAccount,
  getRefTrackingWithClickIds,
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

export async function sendAdConversions(
  db: D1Database,
  friendId: string,
  eventName: string,
  eventValue?: number,
  opts?: { idempotencyKey?: string | null; lineAccountId?: string | null },
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

  const ref = await getRefTrackingWithClickIds(db, friendId);
  if (!ref) return;

  const platforms = await getActiveAdPlatforms(db, lineAccountId);

  for (const platform of platforms) {
    // 二重防御: 帰属が違う設定は送らない(DB側でも claim が弾く)。
    if (platform.line_account_id !== lineAccountId) continue;
    const click = clickIdForPlatform(platform.name, ref);
    if (!click) continue;
    const config: AdPlatformConfig = JSON.parse(platform.config);
    // 媒体側の重複排除ID。再試行では同じIDになるよう鍵から決める。
    const providerEventId = hasStableKey ? `${idempotencyKey}:${platform.id}` : crypto.randomUUID();

    const claim = await claimAdConversionSend(db, {
      platformId: platform.id, friendId, lineAccountId, eventName,
      clickId: click.clickId, clickIdType: click.clickIdType, eventValue: eventValue ?? null, idempotencyKey,
    });
    // mismatch: 同じ鍵で内容が変わった再送は送らない。
    if (claim !== 'send') continue;

    try {
      switch (platform.name) {
        case 'meta':
          await sendMetaConversion(config, ref, eventName, eventValue, providerEventId);
          break;
        case 'x':
          await sendXConversion(config, ref, eventName, eventValue, providerEventId);
          break;
        case 'google':
          await sendGoogleConversion(config, ref, eventName, eventValue);
          break;
        case 'tiktok':
          await sendTikTokConversion(config, ref, eventName, eventValue, providerEventId);
          break;
        default:
          await finishAdConversionSend(db, {
            platformId: platform.id, friendId, eventName, idempotencyKey,
            status: 'failed', errorMessage: `unsupported platform: ${platform.name}`,
          });
          continue;
      }
      await finishAdConversionSend(db, {
        platformId: platform.id, friendId, eventName, idempotencyKey, status: 'sent',
      });
    } catch (error) {
      await finishAdConversionSend(db, {
        platformId: platform.id, friendId, eventName, idempotencyKey,
        status: 'failed', errorMessage: String(error),
      });
    }
  }
}

async function sendMetaConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
  providerEventId?: string,
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
    eventData.custom_data = { currency: 'JPY', value: eventValue };
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
  const url = 'https://ads-api.x.com/12/measurement/conversions';

  const body = {
    conversions: [{
      conversion_time: new Date().toISOString(),
      // 再試行では同じIDで送り、媒体側の重複計上を止める。
      event_id: providerEventId ?? crypto.randomUUID(),
      identifiers: [{ twclid: ref.twclid }],
      conversion_id: config.pixel_id,
      event_name: eventName,
      ...(eventValue && { value: { currency: 'JPY', amount: String(eventValue) } }),
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

async function sendGoogleConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const url = `https://googleads.googleapis.com/v17/customers/${config.customer_id}:uploadClickConversions`;

  const body = {
    conversions: [{
      gclid: ref.gclid,
      conversion_action: `customers/${config.customer_id}/conversionActions/${config.conversion_action_id}`,
      conversion_date_time: new Date().toISOString().replace('Z', '+09:00'),
      ...(eventValue && { conversion_value: eventValue, currency_code: 'JPY' }),
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
}

async function sendTikTokConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
  providerEventId?: string,
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
      ...(eventValue && { currency: 'JPY', value: eventValue }),
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
