import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getAccountSetting,
  getVersionedAccountSetting,
  saveVersionedAccountSetting,
  setAccountSetting,
} from '@line-crm/db';
import {
  DEFAULT_TENANT_ID,
  FEATURE_CATALOG,
  FEATURE_IDS,
  type FeatureId,
} from '@line-crm/shared';
import type { Env } from '../index.js';
import { restaurantTestEnabled } from '../lib/environment-features.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

/**
 * 機能のオン／オフ。
 *
 * account_settings の版付き一括設定を正本にし、旧 `feature.<キー>` は
 * 保存済みデータを読むための互換経路として残す。
 */
const featureSettings = new Hono<Env>();

/** 受け付けるIDは共有カタログそのもの。画面・Workerで別の配列を持たない。 */
export const TOGGLEABLE_FEATURES: readonly FeatureId[] = FEATURE_IDS;
const TOGGLEABLE_FEATURE_SET = new Set<string>(TOGGLEABLE_FEATURES);

export type ToggleableFeature = FeatureId;

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
const FEATURE_SETTINGS_BUNDLE_KEY = 'feature.settings_bundle_v1';

type FeatureSettingsData = {
  features: Record<string, boolean>;
  sidebarOrder: string[] | null;
  sidebarItemOrder: Record<string, string[]> | null;
};

type FeatureSettingsState = FeatureSettingsData & { version: number };

/** 共有カタログで既定オフの機能。記録が無いアカウントではこの状態から始める。 */
export const DEFAULT_DISABLED_FEATURES = new Set<ToggleableFeature>(
  FEATURE_CATALOG.filter(({ defaultEnabled }) => !defaultEnabled).map(({ featureId }) => featureId),
);

/**
 * このリポジトリで専門設計済みの然向け機能。
 * 専門設計が無いサービスでは catalog 設定を空配列にすれば画面に出ない。
 */
export const NEN_SPECIALIZED_FEATURES: ToggleableFeature[] = [
  'nen_campaigns',
  'photo_review',
  'ec_commerce',
  'line_notifications',
];

function isToggleable(key: unknown): key is ToggleableFeature {
  return typeof key === 'string' && TOGGLEABLE_FEATURE_SET.has(key);
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

export function specializedCatalog(raw: string | null): string[] {
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
 * オフ前の影響確認(#643)。
 *
 * 公開・予約・稼働中の仕事を壊さずにオフできるよう、オフにしようと
 * している機能ごとに「公開中」「予約中」「依存機能」の件数と対象種別を
 * 数える。数えるだけでは保存しない。影響がある保存には確認トークンが
 * 要り、状態が変わったら取り直しになる。
 *
 * 数え先はこのアカウントに結び付く行だけにする。アカウント列が空の行を
 * 共有として数えるのは、読み取り側が共有扱いしている表だけ
 * (自動応答・ウェビナー)。それ以外は厳密にこのアカウントの行だけ数え、
 * 他テナントの名寄せなし行を混ぜない。詳しくは FEATURE_IMPACT_COVERAGE。
 */
export type FeatureImpactKind = 'published' | 'scheduled' | 'dependent';

export type FeatureImpactItem = {
  kind: FeatureImpactKind;
  /** 運用者に見せる対象の呼び名。表名や内部IDは出さない。 */
  targetType: string;
  count: number;
};

export type FeatureImpact = {
  feature: ToggleableFeature;
  items: FeatureImpactItem[];
  /** 確認トークンなしでは保存できない影響があるか。 */
  blocking: boolean;
};

/** 確認トークンの置き場。汎用設定表の1行で足り、移行は要らない。 */
const OFF_CONFIRM_KEY = 'feature.off_confirm';
/** 確認から保存までの持ち時間。稼働中は変わるため短めにする。 */
const OFF_CONFIRM_TTL_MS = 10 * 60 * 1000;

type OffConfirmation = {
  token: string;
  impactHash: string;
  version: number;
  expiresAt: number;
};

async function countRows(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...params).first<{ total: number | string | null }>();
  return Number(row?.total ?? 0);
}

/**
 * 一斉配信のアカウント結び付け。複数アカウント宛て(重複除き)は
 * account_ids の JSON 配列にも対象が入る。一覧取得と同じ条件。
 */
const BROADCAST_ACCOUNT_SCOPE = `(b.line_account_id = ?
  OR (b.target_type = 'multi-account-dedup' AND b.account_ids IS NOT NULL
    AND EXISTS (SELECT 1 FROM json_each(b.account_ids) WHERE value = ?)))`;

/** 回答フォームの表示先。結び付けが無いフォームは全アカウントに表示する。 */
const FORM_ACCOUNT_SCOPE = `(NOT EXISTS (SELECT 1 FROM form_accounts fa WHERE fa.form_id = f.id)
  OR EXISTS (SELECT 1 FROM form_accounts fa WHERE fa.form_id = f.id AND fa.line_account_id = ?))`;

/**
 * 全33種の網羅表。切替対象の各機能が「何を数えるか」か
 * 「数えない理由」のどちらかを必ず持つ。FEATURE_CATALOGに機能を
 * 足したらここも足す。足さなければ型検査と契約テストが落ちる。
 *
 * 数え先はこのアカウントに結び付く行だけにする。アカウント列が空の
 * 行を共有として数えるのは、読み取り側が共有扱いしている表だけ
 * (自動応答・ウェビナー)。それ以外は厳密にこのアカウントの行だけ
 * 数え、他テナントの名寄せなし行を混ぜない。アカウントに結び付け
 * られない表は数えず、理由を残して 0 件と混ぜない。
 */
export type FeatureImpactSource = {
  kind: FeatureImpactKind;
  /** 運用者に見せる対象の呼び名。表名や内部IDは出さない。 */
  targetType: string;
  sql: string;
  /** ? の個数。すべて accountId で埋める。 */
  params: 1 | 2;
};

export type FeatureImpactCoverageEntry =
  | { readonly scope: 'counted'; readonly sources: readonly FeatureImpactSource[] }
  | { readonly scope: 'none'; readonly reason: string };

export const FEATURE_IMPACT_COVERAGE: Readonly<Record<FeatureId, FeatureImpactCoverageEntry>> = {
  broadcasts: {
    scope: 'counted',
    sources: [
      {
        kind: 'scheduled',
        targetType: '予約済みの配信',
        sql: `SELECT COUNT(*) AS total FROM broadcasts b WHERE b.status = 'scheduled' AND ${BROADCAST_ACCOUNT_SCOPE}`,
        params: 2,
      },
      {
        kind: 'published',
        targetType: '送信中の配信',
        sql: `SELECT COUNT(*) AS total FROM broadcasts b WHERE b.status = 'sending' AND ${BROADCAST_ACCOUNT_SCOPE}`,
        params: 2,
      },
    ],
  },
  scenarios: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '公開中のシナリオ',
        sql: `SELECT COUNT(*) AS total FROM scenarios WHERE is_active = 1 AND line_account_id = ?`,
        params: 1,
      },
      {
        kind: 'dependent',
        targetType: '回答後にシナリオへつなぐフォーム',
        sql: `SELECT COUNT(*) AS total FROM forms f WHERE f.on_submit_scenario_id IS NOT NULL AND f.is_active = 1 AND ${FORM_ACCOUNT_SCOPE}`,
        params: 1,
      },
      {
        kind: 'dependent',
        targetType: 'シナリオを使う紹介オファー',
        sql: `SELECT COUNT(*) AS total FROM affiliate_offers WHERE scenario_id IS NOT NULL AND is_active = 1 AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  templates: {
    scope: 'counted',
    sources: [
      {
        kind: 'dependent',
        targetType: 'テンプレートを使う自動応答',
        sql: `SELECT COUNT(*) AS total FROM auto_replies WHERE template_id IS NOT NULL AND is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?)`,
        params: 1,
      },
    ],
  },
  reminders: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '有効なリマインド設定',
        sql: `SELECT COUNT(*) AS total FROM reminders WHERE is_active = 1 AND deleted_at IS NULL AND line_account_id = ?`,
        params: 1,
      },
      {
        kind: 'scheduled',
        targetType: '送信待ちのリマインド',
        sql: `SELECT COUNT(*) AS total FROM friend_reminders fr
         JOIN reminders r ON r.id = fr.reminder_id AND r.deleted_at IS NULL AND r.line_account_id = ?
         WHERE fr.status = 'active'`,
        params: 1,
      },
    ],
  },
  auto_replies: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '有効な自動応答',
        sql: `SELECT COUNT(*) AS total FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?)`,
        params: 1,
      },
    ],
  },
  rich_menus: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '利用中のリッチメニュー',
        sql: `SELECT COUNT(*) AS total FROM rich_menu_assignments WHERE line_account_id = ?`,
        params: 1,
      },
    ],
  },
  inflow_tracking: {
    scope: 'none',
    reason: '計測リンクと流入経路の表にアカウント列がなく、アカウント単位で結び付けられない',
  },
  forms: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '公開中の回答フォーム',
        sql: `SELECT COUNT(*) AS total FROM forms f WHERE f.is_active = 1 AND ${FORM_ACCOUNT_SCOPE}`,
        params: 1,
      },
    ],
  },
  photo_review: {
    scope: 'none',
    reason: '審査待ちの表にアカウント列がなく、アカウント単位で結び付けられない',
  },
  automations: {
    scope: 'counted',
    sources: [
      {
        kind: 'scheduled',
        targetType: '実行待ち・実行中の自動処理',
        sql: `SELECT COUNT(*) AS total FROM automation_runs
         WHERE status IN ('queued', 'running', 'waiting') AND is_test = 0 AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  external_integrations: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '有効な受信Webhook',
        sql: `SELECT COUNT(*) AS total FROM incoming_webhooks WHERE is_active = 1 AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  friend_add_routing: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '公開中の振り分けルール',
        sql: `SELECT COUNT(*) AS total FROM friend_add_rules WHERE status = 'published' AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  multi_store_hierarchy: {
    scope: 'none',
    reason: '店舗束の構成設定で、待ち行を持たない',
  },
  multi_store_bulk_updates: {
    scope: 'none',
    reason: '一括更新の待ち行を表に持たない',
  },
  reservation_ledger: {
    scope: 'none',
    reason: '台帳の行にアカウント列がなく、アカウント単位で結び付けられない',
  },
  external_reservations: {
    scope: 'none',
    reason: '外部予約の待ち行を表に持たず、アカウント単位で結び付けられない',
  },
  google_business_profile: {
    scope: 'none',
    reason: '投稿の表にアカウント列がなく、アカウント単位で結び付けられない',
  },
  friend_fields: {
    scope: 'none',
    reason: '属性の値と走査状態にアカウント列がなく、アカウント単位で結び付けられない',
  },
  support_marks: {
    scope: 'none',
    reason: '付け替え申請は状態を持たない記録で、待ち行でない',
  },
  saved_searches: {
    scope: 'none',
    reason: '保存条件と利用履歴で、待ち行を持たない',
  },
  media: {
    scope: 'none',
    reason: '素材の表にアカウント列がなく、アカウント単位で結び付けられない',
  },
  common_vars: {
    scope: 'counted',
    sources: [
      {
        kind: 'scheduled',
        targetType: '反映待ちの共通変数変更',
        sql: `SELECT COUNT(*) AS total FROM common_var_schedules s
         JOIN common_vars v ON v.id = s.var_id AND v.archived_at IS NULL AND v.line_account_id = ?
         WHERE s.applied_at IS NULL`,
        params: 1,
      },
    ],
  },
  analytics: {
    scope: 'counted',
    sources: [
      {
        kind: 'scheduled',
        targetType: '有効なレポート予約',
        sql: `SELECT COUNT(*) AS total FROM analytics_report_schedules WHERE status = 'active' AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  site_tracking: {
    scope: 'none',
    reason: '計測ログは履歴で、待ち行を持たない',
  },
  webinars: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '公開中のウェビナー',
        sql: `SELECT COUNT(*) AS total FROM webinars WHERE status = 'active' AND (account_id IS NULL OR account_id = ?)`,
        params: 1,
      },
      {
        kind: 'scheduled',
        targetType: '送信待ちのウェビナー通知',
        sql: `SELECT COUNT(*) AS total FROM webinar_notification_jobs j
         JOIN webinars w ON w.id = j.webinar_id AND (w.account_id IS NULL OR w.account_id = ?)
         WHERE j.status IN ('queued', 'claimed', 'retry_wait')`,
        params: 1,
      },
    ],
  },
  events: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '公開中のイベント',
        sql: `SELECT COUNT(*) AS total FROM events WHERE is_published = 1 AND deleted_at IS NULL AND line_account_id = ?`,
        params: 1,
      },
      {
        kind: 'scheduled',
        targetType: '受付中のイベント予約',
        sql: `SELECT COUNT(*) AS total FROM event_bookings WHERE status IN ('requested', 'confirmed') AND line_account_id = ?`,
        params: 1,
      },
      {
        kind: 'scheduled',
        targetType: '送信待ちのイベントリマインド',
        sql: `SELECT COUNT(*) AS total FROM event_booking_reminders ebr
         JOIN event_bookings eb ON eb.id = ebr.booking_id AND eb.line_account_id = ?
         WHERE ebr.status = 'pending'`,
        params: 1,
      },
    ],
  },
  booking: {
    scope: 'counted',
    sources: [
      {
        kind: 'scheduled',
        targetType: '受付中の予約',
        sql: `SELECT COUNT(*) AS total FROM bookings WHERE status IN ('requested', 'confirmed') AND line_account_id = ?`,
        params: 1,
      },
      {
        kind: 'scheduled',
        targetType: '送信待ちの予約リマインド',
        sql: `SELECT COUNT(*) AS total FROM booking_reminders br
         JOIN bookings b ON b.id = br.booking_id AND b.line_account_id = ?
         WHERE br.status = 'pending'`,
        params: 1,
      },
    ],
  },
  affiliates: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '受付中の紹介オファー',
        sql: `SELECT COUNT(*) AS total FROM affiliate_offers WHERE is_active = 1 AND line_account_id = ?`,
        params: 1,
      },
      {
        kind: 'scheduled',
        targetType: '精算待ちの支払い',
        sql: `SELECT COUNT(*) AS total FROM affiliate_payout_batches
         WHERE state IN ('created', 'approved') AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  mileage: {
    scope: 'counted',
    sources: [
      {
        kind: 'scheduled',
        targetType: '処理中のマイル交換',
        sql: `SELECT COUNT(*) AS total FROM mileage_redemptions
         WHERE status IN ('reserved', 'delivering') AND line_account_id = ?`,
        params: 1,
      },
      {
        kind: 'dependent',
        targetType: 'マイル特典を使う紹介オファー',
        sql: `SELECT COUNT(*) AS total FROM affiliate_offers
         WHERE mileage_program_id IS NOT NULL AND is_active = 1 AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  ec_commerce: {
    scope: 'counted',
    sources: [
      {
        kind: 'scheduled',
        targetType: '処理中のEC注文',
        sql: `SELECT COUNT(*) AS total FROM ec_orders
         WHERE normalized_status = 'current' AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  line_notifications: {
    scope: 'counted',
    sources: [
      {
        kind: 'published',
        targetType: '有効な通知ルール',
        sql: `SELECT COUNT(*) AS total FROM notification_rules WHERE is_active = 1 AND line_account_id = ?`,
        params: 1,
      },
      {
        kind: 'scheduled',
        targetType: '送信待ちの通知',
        sql: `SELECT COUNT(*) AS total FROM notification_deliveries
         WHERE status IN ('pending', 'provider_accepted', 'retry_wait')
         AND execution_mode != 'test' AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  nen_campaigns: {
    scope: 'counted',
    sources: [
      {
        kind: 'scheduled',
        targetType: '送信待ちのNEN配信',
        sql: `SELECT COUNT(*) AS total FROM nen_delivery_jobs
         WHERE status IN ('pending', 'processing') AND line_account_id = ?`,
        params: 1,
      },
    ],
  },
  restaurant_test: {
    scope: 'none',
    reason: '検証用のため、本番の稼働対象としない',
  },
};

async function collectFeatureImpact(
  db: D1Database,
  accountId: string,
  feature: ToggleableFeature,
): Promise<FeatureImpactItem[]> {
  const entry = FEATURE_IMPACT_COVERAGE[feature];
  if (!entry) {
    throw new Error(`影響の数え先が未定義です: ${String(feature)}`);
  }
  if (entry.scope === 'none') return [];
  const items: FeatureImpactItem[] = [];
  for (const source of entry.sources) {
    const params = source.params === 2 ? [accountId, accountId] : [accountId];
    const count = await countRows(db, source.sql, ...params);
    if (count > 0) items.push({ kind: source.kind, targetType: source.targetType, count });
  }
  return items;
}

/** 保存案の実効値。無効環境の飲食店テストは保存時と同じく無効に倒す。 */
function effectiveFeatures(
  current: Record<string, boolean>,
  incoming: Record<string, unknown> | undefined,
  restaurantEnabled: boolean,
): Record<string, boolean> {
  const next = { ...current };
  for (const [key, value] of Object.entries(incoming ?? {})) {
    next[key] = key === 'restaurant_test' && !restaurantEnabled ? false : (value as boolean);
  }
  return next;
}

/** 有効→無効に変わる機能だけが影響確認の対象。 */
function offTransitions(
  current: Record<string, boolean>,
  next: Record<string, boolean>,
): ToggleableFeature[] {
  return (Object.keys(next) as ToggleableFeature[]).filter(
    (key) => isToggleable(key) && current[key] === true && next[key] === false,
  );
}

async function impactFingerprint(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readOffConfirmation(db: D1Database, accountId: string): Promise<OffConfirmation | null> {
  const raw = await getAccountSetting(db, accountId, OFF_CONFIRM_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OffConfirmation>;
    if (typeof parsed.token !== 'string' || typeof parsed.impactHash !== 'string'
      || typeof parsed.version !== 'number' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    if (parsed.expiresAt <= Date.now()) {
      await db.prepare('DELETE FROM account_settings WHERE line_account_id = ? AND key = ?')
        .bind(accountId, OFF_CONFIRM_KEY).run();
      return null;
    }
    return parsed as OffConfirmation;
  } catch {
    return null;
  }
}

async function deleteOffConfirmation(db: D1Database, accountId: string): Promise<void> {
  await db.prepare('DELETE FROM account_settings WHERE line_account_id = ? AND key = ?')
    .bind(accountId, OFF_CONFIRM_KEY).run();
}

/** 変更案の影響を数える。保存はしない。 */
async function buildImpacts(
  db: D1Database,
  accountId: string,
  offs: ToggleableFeature[],
): Promise<FeatureImpact[]> {
  const impacts: FeatureImpact[] = [];
  for (const feature of offs) {
    const items = await collectFeatureImpact(db, accountId, feature);
    impacts.push({ feature, items, blocking: items.length > 0 });
  }
  return impacts;
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

function cleanStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (values.length !== raw.length || new Set(values).size !== values.length) return null;
  return values;
}

function cleanItemOrder(raw: unknown): Record<string, string[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cleaned: Record<string, string[]> = {};
  for (const [sectionId, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!sectionId) return null;
    const values = cleanStringArray(ids);
    if (!values) return null;
    cleaned[sectionId] = values;
  }
  return cleaned;
}

async function loadLegacyFeatureSettings(
  db: D1Database,
  accountId: string,
  restaurantEnabled: boolean,
): Promise<FeatureSettingsData> {
  const rawFeatures = await Promise.all(
    TOGGLEABLE_FEATURES.map((key) => getAccountSetting(db, accountId, `${SETTING_PREFIX}${key}`)),
  );
  const features: Record<string, boolean> = {};
  TOGGLEABLE_FEATURES.forEach((key, index) => {
    features[key] = key === 'restaurant_test' && !restaurantEnabled
      ? false
      : featureIsEnabled(rawFeatures[index] ?? null, key);
  });

  const [orderRaw, itemOrderRaw] = await Promise.all([
    getAccountSetting(db, accountId, SIDEBAR_ORDER_KEY),
    getAccountSetting(db, accountId, SIDEBAR_ITEM_ORDER_KEY),
  ]);
  let sidebarOrder: string[] | null = null;
  let sidebarItemOrder: Record<string, string[]> | null = null;
  try {
    sidebarOrder = orderRaw ? cleanStringArray(JSON.parse(orderRaw)) : null;
  } catch {
    sidebarOrder = null;
  }
  try {
    sidebarItemOrder = itemOrderRaw ? cleanItemOrder(JSON.parse(itemOrderRaw)) : null;
  } catch {
    sidebarItemOrder = null;
  }
  return { features, sidebarOrder, sidebarItemOrder };
}

async function loadFeatureSettings(
  db: D1Database,
  accountId: string,
  restaurantEnabled: boolean,
): Promise<FeatureSettingsState> {
  const saved = await getVersionedAccountSetting<FeatureSettingsData>(
    db,
    accountId,
    FEATURE_SETTINGS_BUNDLE_KEY,
  );
  if (!saved) {
    return {
      ...(await loadLegacyFeatureSettings(db, accountId, restaurantEnabled)),
      version: 0,
    };
  }

  const features: Record<string, boolean> = {};
  for (const key of TOGGLEABLE_FEATURES) {
    const value = saved.data.features?.[key];
    features[key] = key === 'restaurant_test' && !restaurantEnabled
      ? false
      : typeof value === 'boolean' ? value : featureIsEnabled(null, key);
  }
  return {
    version: saved.version,
    features,
    sidebarOrder: cleanStringArray(saved.data.sidebarOrder) ?? null,
    sidebarItemOrder: cleanItemOrder(saved.data.sidebarItemOrder) ?? null,
  };
}

featureSettings.get('/api/settings/features', async (c) => {
  try {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const state = await loadFeatureSettings(
      c.env.DB,
      accountId,
      restaurantTestEnabled(c.env),
    );

    const [parentChildRaw, specializedRaw] = await Promise.all([
      getAccountSetting(c.env.DB, accountId, PARENT_CHILD_MODE_KEY),
      getAccountSetting(c.env.DB, accountId, SPECIALIZED_CATALOG_KEY),
    ]);

    return c.json({
      success: true,
      data: {
        features: state.features,
        sidebarOrder: state.sidebarOrder,
        sidebarItemOrder: state.sidebarItemOrder,
        version: state.version,
        parentChildMode: settingIsEnabled(parentChildRaw),
        specializedFeatureKeys: specializedCatalog(specializedRaw),
      },
    });
  } catch (err) {
    console.error('GET /api/settings/features error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 変更案の影響確認。保存はしない。
 *
 * 有効→無効に変わる機能ごとに公開中・予約中・依存機能の件数と対象種別を
 * 返す。止まる仕事があるときだけ確認トークンを発行し、保存時に求める。
 * 影響がなければトークンは要らない(通常保存)。
 */
featureSettings.post('/api/settings/features/impact', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }

    const body = await c.req.json<{
      features?: Record<string, unknown>;
      expectedVersion?: unknown;
    }>();

    if (body.features !== undefined && (typeof body.features !== 'object' || body.features === null || Array.isArray(body.features))) {
      return c.json({ success: false, error: 'features はオブジェクトで指定してください' }, 400);
    }
    const unknownKeys = Object.keys(body.features ?? {}).filter((k) => !isToggleable(k));
    if (unknownKeys.length > 0) {
      return c.json(
        { success: false, error: `知らない機能です: ${unknownKeys.join(', ')}` },
        400,
      );
    }
    const invalidFeature = Object.entries(body.features ?? {})
      .find(([, value]) => typeof value !== 'boolean');
    if (invalidFeature) {
      return c.json({
        success: false,
        error: `${invalidFeature[0]} はtrueまたはfalseで指定してください`,
      }, 400);
    }
    if (body.expectedVersion !== undefined
      && (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0)) {
      return c.json({
        success: false,
        error: 'expectedVersion は0以上の整数で指定してください',
      }, 400);
    }

    const restaurantEnabled = restaurantTestEnabled(c.env);
    const current = await loadFeatureSettings(c.env.DB, accountId, restaurantEnabled);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) {
      return c.json({
        success: false,
        error: '別の管理者が先に変更しました。最新の設定を読み直してください。',
        data: { currentVersion: current.version },
      }, 409);
    }

    const next = effectiveFeatures(current.features, body.features, restaurantEnabled);
    const offs = offTransitions(current.features, next);
    const impacts = await buildImpacts(c.env.DB, accountId, offs);
    const requiresConfirmation = impacts.some((impact) => impact.blocking);

    let impactToken: string | null = null;
    if (requiresConfirmation) {
      impactToken = crypto.randomUUID();
      const impactHash = await impactFingerprint({
        accountId,
        version: current.version,
        features: next,
        impacts,
      });
      await setAccountSetting(
        c.env.DB,
        accountId,
        OFF_CONFIRM_KEY,
        JSON.stringify({
          token: impactToken,
          impactHash,
          version: current.version,
          expiresAt: Date.now() + OFF_CONFIRM_TTL_MS,
        } satisfies OffConfirmation),
      );
    } else if (offs.length > 0) {
      await deleteOffConfirmation(c.env.DB, accountId);
    }

    return c.json({
      success: true,
      data: { version: current.version, impacts, requiresConfirmation, impactToken },
    });
  } catch (err) {
    console.error('POST /api/settings/features/impact error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

featureSettings.put('/api/settings/features', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }

    const body = await c.req.json<{
      features?: Record<string, unknown>;
      sidebarOrder?: unknown;
      sidebarItemOrder?: unknown;
      catalog?: unknown;
      expectedVersion?: unknown;
      impactToken?: unknown;
    }>();

    let catalog: ToggleableFeature[] | undefined;
    if (body.catalog !== undefined) {
      const staff = c.get('staff');
      // #558: 運営ロール未導入の現行契約では、既定統括の owner だけが変更できる。
      if (staff?.role !== 'owner' || staff.readOnly
        || (staff.tenantId ?? DEFAULT_TENANT_ID) !== DEFAULT_TENANT_ID) {
        return c.json({ success: false, error: 'この操作には運営権限が必要です' }, 403);
      }
      if (!Array.isArray(body.catalog)) {
        return c.json({ success: false, error: 'catalog は配列で指定してください' }, 400);
      }
      if (body.catalog.some((key) => typeof key !== 'string'
        || !NEN_SPECIALIZED_FEATURES.includes(key as ToggleableFeature))) {
        return c.json({ success: false, error: 'catalog に知らない専用機能が含まれています' }, 400);
      }
      catalog = body.catalog.filter(
        (key): key is ToggleableFeature => typeof key === 'string'
          && NEN_SPECIALIZED_FEATURES.includes(key as ToggleableFeature),
      );
    }

    const unknownKeys = Object.keys(body.features ?? {}).filter((k) => !isToggleable(k));
    if (unknownKeys.length > 0) {
      return c.json(
        { success: false, error: `知らない機能です: ${unknownKeys.join(', ')}` },
        400,
      );
    }
    const invalidFeature = Object.entries(body.features ?? {})
      .find(([, value]) => typeof value !== 'boolean');
    if (invalidFeature) {
      return c.json({
        success: false,
        error: `${invalidFeature[0]} はtrueまたはfalseで指定してください`,
      }, 400);
    }

    let sidebarOrder: string[] | null | undefined;
    if (body.sidebarOrder !== undefined) {
      sidebarOrder = cleanStringArray(body.sidebarOrder);
      if (!sidebarOrder) {
        return c.json({
          success: false,
          error: 'sidebarOrder は重複のない文字列配列で指定してください',
        }, 400);
      }
    }

    let sidebarItemOrder: Record<string, string[]> | null | undefined;
    if (body.sidebarItemOrder !== undefined) {
      sidebarItemOrder = cleanItemOrder(body.sidebarItemOrder);
      if (!sidebarItemOrder) {
        return c.json({
          success: false,
          error: 'sidebarItemOrder は重複のない文字列配列を持つオブジェクトで指定してください',
        }, 400);
      }
    }

    if (body.expectedVersion !== undefined
      && (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0)) {
      return c.json({
        success: false,
        error: 'expectedVersion は0以上の整数で指定してください',
      }, 400);
    }
    if (body.impactToken !== undefined && typeof body.impactToken !== 'string') {
      return c.json({
        success: false,
        error: 'impactToken は文字列で指定してください',
      }, 400);
    }

    /**
     * オフ前の影響確認(#643)。有効→無効に変わる機能に止まる仕事が
     * あるのに、有効な確認トークンが無ければ保存しない。直接PUTでの
     * 迂回もここで止める。影響が無ければ通常保存する。
     */
    const restaurantEnabledForImpact = restaurantTestEnabled(c.env);
    let presentedToken: string | null = null;
    if (body.features !== undefined) {
      const impactCurrent = await loadFeatureSettings(
        c.env.DB,
        accountId,
        restaurantEnabledForImpact,
      );
      const impactNext = effectiveFeatures(
        impactCurrent.features,
        body.features,
        restaurantEnabledForImpact,
      );
      const impactOffs = offTransitions(impactCurrent.features, impactNext);
      if (impactOffs.length > 0) {
        const impacts = await buildImpacts(c.env.DB, accountId, impactOffs);
        if (impacts.some((impact) => impact.blocking)) {
          const fingerprint = await impactFingerprint({
            accountId,
            version: impactCurrent.version,
            features: impactNext,
            impacts,
          });
          const saved = await readOffConfirmation(c.env.DB, accountId);
          if (typeof body.impactToken !== 'string'
            || !saved
            || saved.token !== body.impactToken
            || saved.impactHash !== fingerprint
            || saved.version !== impactCurrent.version) {
            return c.json({
              success: false,
              error: 'オフにしようとしている機能に、公開中・予約中・依存中のものがあります。内容を確認してから保存してください。',
              code: 'IMPACT_CONFIRMATION_REQUIRED',
              data: { impacts, currentVersion: impactCurrent.version },
            }, 409);
          }
          presentedToken = body.impactToken;
        }
      }
    }

    const hasBundleUpdate = body.features !== undefined
      || body.sidebarOrder !== undefined
      || body.sidebarItemOrder !== undefined;
    let savedVersion: number | null = null;

    if (hasBundleUpdate && body.expectedVersion !== undefined) {
      const current = await loadFeatureSettings(
        c.env.DB,
        accountId,
        restaurantTestEnabled(c.env),
      );
      const incomingFeatures = { ...(body.features ?? {}) } as Record<string, boolean>;
      if (!restaurantTestEnabled(c.env) && 'restaurant_test' in incomingFeatures) {
        incomingFeatures.restaurant_test = false;
      }
      const result = await saveVersionedAccountSetting(c.env.DB, {
        accountId,
        key: FEATURE_SETTINGS_BUNDLE_KEY,
        expectedVersion: Number(body.expectedVersion),
        data: {
          features: { ...current.features, ...incomingFeatures },
          sidebarOrder: sidebarOrder === undefined ? current.sidebarOrder : sidebarOrder,
          sidebarItemOrder: sidebarItemOrder === undefined
            ? current.sidebarItemOrder
            : sidebarItemOrder,
        },
      });
      if (result.status === 'conflict') {
        return c.json({
          success: false,
          error: '別の管理者が先に変更しました。最新の設定を読み直してください。',
          data: { currentVersion: result.current?.version ?? 0 },
        }, 409);
      }
      savedVersion = result.setting.version;
    } else if (hasBundleUpdate) {
      // #558: 旧クライアント互換のため、expectedVersion なしの形式も当面受け付ける。
      for (const [key, value] of Object.entries(body.features ?? {})) {
        const enabled = key === 'restaurant_test' && !restaurantTestEnabled(c.env)
          ? false
          : value;
        await setAccountSetting(
          c.env.DB,
          accountId,
          `${SETTING_PREFIX}${key}`,
          JSON.stringify({ enabled }),
        );
      }
      if (sidebarOrder !== undefined) {
        await setAccountSetting(
          c.env.DB,
          accountId,
          SIDEBAR_ORDER_KEY,
          JSON.stringify(sidebarOrder),
        );
      }
      if (sidebarItemOrder !== undefined) {
        await setAccountSetting(
          c.env.DB,
          accountId,
          SIDEBAR_ITEM_ORDER_KEY,
          JSON.stringify(sidebarItemOrder),
        );
      }
    }

    if (catalog !== undefined) {
      await setAccountSetting(
        c.env.DB,
        accountId,
        SPECIALIZED_CATALOG_KEY,
        JSON.stringify(catalog),
      );
    }

    // 確認トークンは使い切り。同じトークンの使い回しは受け付けない。
    if (presentedToken !== null) {
      await deleteOffConfirmation(c.env.DB, accountId);
    }

    return c.json({
      success: true,
      data: savedVersion === null ? null : { version: savedVersion },
    });
  } catch (err) {
    console.error('PUT /api/settings/features error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { featureSettings };
