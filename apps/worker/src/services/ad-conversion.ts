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
  opts?: { idempotencyKey?: string | null },
): Promise<void> {
  // 友だちの所属アカウントを確定し、そのアカウントの広告設定だけ使う。
  // 所属が分からない友だちの行動・金額は外部へ送らない。
  const friend = await db
    .prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
    .bind(friendId)
    .first<{ line_account_id: string | null }>();
  const lineAccountId = friend?.line_account_id ?? null;
  if (!lineAccountId) return;

  const ref = await getRefTrackingWithClickIds(db, friendId);
  if (!ref) return;

  const platforms = await getActiveAdPlatforms(db, lineAccountId);
  // 呼び出しをまたいだ重複送信を止める安定キー。無いときは今回限りの鍵にする。
  const idempotencyKey = opts?.idempotencyKey || crypto.randomUUID();

  for (const platform of platforms) {
    // 二重防御: 帰属が違う設定は送らない(DB側でも claim が弾く)。
    if (platform.line_account_id !== lineAccountId) continue;
    const click = clickIdForPlatform(platform.name, ref);
    if (!click) continue;
    const config: AdPlatformConfig = JSON.parse(platform.config);

    const claim = await claimAdConversionSend(db, {
      platformId: platform.id, friendId, lineAccountId, eventName,
      clickId: click.clickId, clickIdType: click.clickIdType, idempotencyKey,
    });
    if (claim !== 'send') continue;

    try {
      switch (platform.name) {
        case 'meta':
          await sendMetaConversion(config, ref, eventName, eventValue);
          break;
        case 'x':
          await sendXConversion(config, ref, eventName, eventValue);
          break;
        case 'google':
          await sendGoogleConversion(config, ref, eventName, eventValue);
          break;
        case 'tiktok':
          await sendTikTokConversion(config, ref, eventName, eventValue);
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
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${config.pixel_id}/events`;

  const eventData: Record<string, unknown> = {
    event_name: eventName,
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

async function sendXConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const url = 'https://ads-api.x.com/12/measurement/conversions';

  const body = {
    conversions: [{
      conversion_time: new Date().toISOString(),
      event_id: crypto.randomUUID(),
      identifiers: [{ twclid: ref.twclid }],
      conversion_id: config.pixel_id,
      event_name: eventName,
      ...(eventValue && { value: { currency: 'JPY', amount: String(eventValue) } }),
    }],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // OAuth 1.0a signature required — placeholder for production implementation
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
): Promise<void> {
  const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

  const body = {
    pixel_code: config.pixel_code,
    event: eventName,
    event_id: crypto.randomUUID(),
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
