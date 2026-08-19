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
 * V2 10-3 でオフと定義された機能だけ既定を無効にし、それ以外は有効。
 * 保存済みの値がある場合は、そちらを優先する。
 */
export const TOGGLEABLE_FEATURES = [
  'scenarios',
  'broadcasts',
  'templates',
  'reminders',
  'auto_replies',
  'rich_menus',
  'inflow_tracking',
  'forms',
  'photo_review',
  // サイドメニューにあってオン／オフの受け口が無かったもの。
  // 受け口が無いと、機能設定に並べてもスイッチが保存されない。
  'automations',
  'external_integrations',
  'friend_add_routing',
  'multi_store_hierarchy',
  'multi_store_bulk_updates',
  'reservation_ledger',
  'external_reservations',
  'google_business_profile',
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
/**
 * 区分の中の項目の並び。`{ 区分の目印: [項目の目印, ...] }`。
 *
 * 区分の並び（sidebar.order）とは別に持つ。1つにまとめると、項目を1つ
 * 動かすたびに区分の並びまで書き直すことになり、片方の保存が古いときに
 * もう片方まで巻き戻る。
 */
const SIDEBAR_ITEM_ORDER_KEY = 'sidebar.item_order';
const PARENT_CHILD_MODE_KEY = 'organization.parent_child_enabled';
const SPECIALIZED_CATALOG_KEY = 'feature.specialized.catalog';

/** V2 10-3 の初期表示。記録が無い契約ではこの状態から始める。 */
export const DEFAULT_DISABLED_FEATURES = new Set<ToggleableFeature>([
  'webinars',
  'affiliates',
  'multi_store_hierarchy',
  'multi_store_bulk_updates',
  'reservation_ledger',
  'external_reservations',
  'google_business_profile',
]);

/**
 * このリポジトリで専門設計済みの然向け機能。
 * 専門設計が無いサービスでは catalog 設定を空配列にすれば画面に出ない。
 */
export const NEN_SPECIALIZED_FEATURES: ToggleableFeature[] = [
  'nen_campaigns',
  'photo_review',
  'ec_commerce',
];

function isToggleable(key: unknown): key is ToggleableFeature {
  return typeof key === 'string' && (TOGGLEABLE_FEATURES as readonly string[]).includes(key);
}

export function featureIsEnabled(raw: string | null, key: ToggleableFeature): boolean {
  if (!raw) return !DEFAULT_DISABLED_FEATURES.has(key);
  try {
    return (JSON.parse(raw) as { enabled?: boolean }).enabled !== false;
  } catch {
    return !DEFAULT_DISABLED_FEATURES.has(key);
  }
}

function settingIsEnabled(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as boolean | { enabled?: boolean };
    return typeof parsed === 'boolean' ? parsed : parsed.enabled === true;
  } catch {
    return false;
  }
}

function specializedCatalog(raw: string | null): string[] {
  if (!raw) return [...NEN_SPECIALIZED_FEATURES];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...NEN_SPECIALIZED_FEATURES];
    return parsed.map(String).filter((key) => NEN_SPECIALIZED_FEATURES.includes(key as ToggleableFeature));
  } catch {
    return [...NEN_SPECIALIZED_FEATURES];
  }
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
      features[key] = featureIsEnabled(raw, key);
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

    const itemOrderRaw = await getAccountSetting(c.env.DB, accountId, SIDEBAR_ITEM_ORDER_KEY);
    let sidebarItemOrder: Record<string, string[]> | null = null;
    if (itemOrderRaw) {
      try {
        const parsed = JSON.parse(itemOrderRaw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const cleaned: Record<string, string[]> = {};
          for (const [sectionId, ids] of Object.entries(parsed as Record<string, unknown>)) {
            if (Array.isArray(ids)) cleaned[sectionId] = ids.map(String);
          }
          sidebarItemOrder = cleaned;
        }
      } catch {
        // 壊れていたら既定の並びで出す。読めない値で画面を落とさない。
        sidebarItemOrder = null;
      }
    }

    const [parentChildRaw, specializedRaw] = await Promise.all([
      getAccountSetting(c.env.DB, accountId, PARENT_CHILD_MODE_KEY),
      getAccountSetting(c.env.DB, accountId, SPECIALIZED_CATALOG_KEY),
    ]);

    return c.json({
      success: true,
      data: {
        features,
        sidebarOrder,
        sidebarItemOrder,
        parentChildMode: settingIsEnabled(parentChildRaw),
        specializedFeatureKeys: specializedCatalog(specializedRaw),
      },
    });
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
      sidebarItemOrder?: unknown;
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

    if (body.sidebarItemOrder !== undefined) {
      const raw = body.sidebarItemOrder;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return c.json({ success: false, error: 'sidebarItemOrder はオブジェクトで指定してください' }, 400);
      }
      const cleaned: Record<string, string[]> = {};
      for (const [sectionId, ids] of Object.entries(raw as Record<string, unknown>)) {
        if (!Array.isArray(ids)) {
          return c.json({ success: false, error: `sidebarItemOrder.${sectionId} は配列で指定してください` }, 400);
        }
        cleaned[sectionId] = ids.map(String);
      }
      await setAccountSetting(
        c.env.DB,
        accountId,
        SIDEBAR_ITEM_ORDER_KEY,
        JSON.stringify(cleaned),
      );
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('PUT /api/settings/features error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { featureSettings };
