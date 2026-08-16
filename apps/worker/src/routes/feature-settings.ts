import { Hono } from 'hono';
import type { Context } from 'hono';
import { getAccountSetting, setAccountSetting } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

/**
 * 機能のオン／オフ。
 *
 * 新しいテーブルは要らない。account_settings が既に key/value の置き場で、
 * ここへ 'feature.<キー>' として入れる。機能が増えるたびに列を足す形に
 * すると、機能を1つ足すのにマイグレーションが要ることになる。
 */
const featureSettings = new Hono<Env>();

/**
 * 切り替えられる機能。
 *
 * ここに無いキーは受け付けない。任意のキーを書けるようにすると、
 * 打ち間違いがそのまま保存され、「切ったはずなのに出ている」という
 * 形で表に出る。
 *
 * 既定はすべて有効。切ったものだけを記録するので、機能を足したときに
 * 既存の環境で勝手に消えることがない。
 */
export const TOGGLEABLE_FEATURES = [
  'friend_fields',
  'support_marks',
  'saved_searches',
  'media',
  'common_vars',
  'analytics',
  'site_tracking',
  'webinars',
  'events',
  'booking',
  'affiliates',
  'mileage',
  'ec_commerce',
  'nen_campaigns',
] as const;

export type ToggleableFeature = (typeof TOGGLEABLE_FEATURES)[number];

const SETTING_PREFIX = 'feature.';
const SIDEBAR_ORDER_KEY = 'sidebar.order';

function isToggleable(key: unknown): key is ToggleableFeature {
  return typeof key === 'string' && (TOGGLEABLE_FEATURES as readonly string[]).includes(key);
}

/**
 * アカウントを決める。
 *
 * 機能のオン／オフはアカウントごとに持つ。店舗ごとに使う機能が違うため。
 * 指定が無ければ 400 を返す。既定のアカウントへ黙って書くと、
 * 別の店の設定を変えてしまう。
 */
function getAccountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || null;
}

featureSettings.get('/api/settings/features', async (c) => {
  try {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

    const features: Record<string, boolean> = {};
    for (const key of TOGGLEABLE_FEATURES) {
      const raw = await getAccountSetting(c.env.DB, accountId, `${SETTING_PREFIX}${key}`);
      // 記録が無ければ有効。切ったものだけを記録する。
      if (!raw) {
        features[key] = true;
        continue;
      }
      try {
        features[key] = (JSON.parse(raw) as { enabled?: boolean }).enabled !== false;
      } catch {
        // 壊れた記録は有効として扱う。読めないから隠す、では
        // 使えていた機能が黙って消える。
        features[key] = true;
      }
    }

    const orderRaw = await getAccountSetting(c.env.DB, accountId, SIDEBAR_ORDER_KEY);
    let sidebarOrder: string[] | null = null;
    if (orderRaw) {
      try {
        const parsed = JSON.parse(orderRaw) as unknown;
        if (Array.isArray(parsed)) sidebarOrder = parsed.map(String);
      } catch {
        sidebarOrder = null;
      }
    }

    return c.json({ success: true, data: { features, sidebarOrder } });
  } catch (err) {
    console.error('GET /api/settings/features error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

featureSettings.put('/api/settings/features', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

    const body = await c.req.json<{
      features?: Record<string, unknown>;
      sidebarOrder?: unknown;
    }>();

    const unknownKeys = Object.keys(body.features ?? {}).filter((k) => !isToggleable(k));
    if (unknownKeys.length > 0) {
      return c.json(
        { success: false, error: `知らない機能です: ${unknownKeys.join(', ')}` },
        400,
      );
    }

    for (const [key, value] of Object.entries(body.features ?? {})) {
      await setAccountSetting(
        c.env.DB,
        accountId,
        `${SETTING_PREFIX}${key}`,
        JSON.stringify({ enabled: value !== false }),
      );
    }

    if (body.sidebarOrder !== undefined) {
      if (!Array.isArray(body.sidebarOrder)) {
        return c.json({ success: false, error: 'sidebarOrder は配列で指定してください' }, 400);
      }
      await setAccountSetting(
        c.env.DB,
        accountId,
        SIDEBAR_ORDER_KEY,
        JSON.stringify(body.sidebarOrder.map(String)),
      );
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('PUT /api/settings/features error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { featureSettings };
