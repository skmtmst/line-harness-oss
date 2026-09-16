/**
 * ログインユーザーの権限モデル正本（N-424 / v6-30 §6-7）。
 *
 * 画面の「項目ごとに決める」3択（変えられる=edit / 見えるだけ=view /
 * 出さない=none）と、役割bundleの初期値をここに置く。
 * worker の認可 middleware と web の編集画面が同じ表を見る。
 */

/** 機能ごとの3段階。none はキーを持たないことで表す。 */
export type FeatureAccessLevel = 'edit' | 'view' | 'none';

/** 個人情報（スタッフのメールアドレス）の見せ方。 */
export type EmailMaskLevel = 'full' | 'masked' | 'none';

export type AccessRoleBundleId =
  | 'administrator'
  | 'operations'
  | 'reception'
  | 'view_only'
  | 'custom';

/** bundle id の一覧（入力検証・API応答で使う）。 */
export const ACCESS_ROLE_BUNDLE_IDS: readonly AccessRoleBundleId[] = [
  'administrator',
  'operations',
  'reception',
  'view_only',
  'custom',
];

/** スタッフ一覧のメールをマスクせず見られる granular 権限（既存）。 */
export const ACCESS_USER_EMAIL_VIEW_KEY = 'access.user.email.view';

/** ログインユーザー管理の閲覧・監査閲覧の granular 権限（既存）。 */
export const ACCESS_USER_VIEW_KEY = 'access.user.view';
export const ACCESS_AUDIT_VIEW_KEY = 'access.audit.view';

/**
 * 「項目ごとに決める」の各行。keys は edit/view 両レベルで使う
 * permission key の集合（middleware の permissionForApiPath が返す値）。
 */
export interface ScopeItem {
  id: string;
  label: string;
  note: string;
  kind: 'feature' | 'email_mask';
  keys: readonly string[];
  hint?: string;
}

export const SCOPE_ITEMS: readonly ScopeItem[] = [
  {
    id: 'friends',
    label: '友だち',
    note: '名前・タグ・対応状況',
    kind: 'feature',
    keys: ['/friends', '/tags'],
  },
  {
    id: 'pii',
    label: '個人情報',
    note: '電話番号・住所・メール',
    kind: 'email_mask',
    keys: [],
    hint: 'メールアドレスを伏せて表示します',
  },
  {
    id: 'delivery',
    label: '配信',
    note: '一斉配信・シナリオ・リマインダ',
    kind: 'feature',
    keys: [
      '/broadcasts',
      '/scenarios',
      '/reminders',
      '/auto-replies',
      '/friend-add-settings',
      '/templates',
      '/rich-menus',
      '/line-notifications',
      '/nen-campaigns',
      '/nen-members',
      '/webinars',
      '/contents',
      '/contents/vars',
      '/form-submissions',
    ],
    hint: '誤送信を防ぐためです',
  },
  {
    id: 'inbox',
    label: '受信箱',
    note: '友だちとのやりとり',
    kind: 'feature',
    keys: ['/chats'],
  },
  {
    id: 'booking',
    label: '予約',
    note: '予約・イベントの受付',
    kind: 'feature',
    keys: ['/booking/bookings', '/booking/menus', '/events'],
  },
  {
    id: 'analytics',
    label: '分析',
    note: '成果・流入・レポート',
    kind: 'feature',
    keys: [
      '/',
      '/analytics',
      '/conversions',
      '/mileage',
      '/inflow-links',
      '/scoring',
      'conversion.approval.edit',
    ],
    hint: '売上の数字が見えます',
  },
  {
    id: 'settings',
    label: '設定',
    note: 'LINE・外部連携・ユーザー',
    kind: 'feature',
    keys: ['/webhooks', '/ec-commerce', ACCESS_USER_VIEW_KEY, ACCESS_AUDIT_VIEW_KEY],
  },
  {
    id: 'operations',
    label: '運用状態',
    note: '健全性・緊急停止・更新履歴',
    kind: 'feature',
    keys: ['/health'],
  },
];

export const SCOPE_ITEM_IDS: readonly string[] = SCOPE_ITEMS.map((item) => item.id);

/** 3択の表。行 id → レベル。 */
export type ScopeLevels = Record<string, FeatureAccessLevel>;

export interface BundlePreset {
  levels: ScopeLevels;
  emailMask: EmailMaskLevel;
}

/**
 * bundle の初期権限（v6-30 §6 が正本）。
 *
 * - 管理者: 全機能 edit（実際の判定は role=owner/admin が全通過）
 * - 運用: 配信・予約・コンテンツ・受信箱・友だちを edit、分析・運用状態は view
 * - 受付: 受信箱・予約を edit、友だちは限定表示(view)。売上・配信・設定は非表示
 * - 見るだけ: 全機能 view（access_level=read_only が変更系も止める）
 * - カスタム: 既定なし。管理者が項目ごとに決める
 */
export const BUNDLE_PRESETS: Record<Exclude<AccessRoleBundleId, 'custom'>, BundlePreset> = {
  administrator: {
    levels: Object.fromEntries(SCOPE_ITEM_IDS.map((id) => [id, 'edit' as const])),
    emailMask: 'full',
  },
  operations: {
    levels: {
      friends: 'edit',
      pii: 'view',
      delivery: 'edit',
      inbox: 'edit',
      booking: 'edit',
      analytics: 'view',
      settings: 'none',
      operations: 'view',
    },
    emailMask: 'masked',
  },
  reception: {
    levels: {
      friends: 'view',
      pii: 'view',
      delivery: 'none',
      inbox: 'edit',
      booking: 'edit',
      analytics: 'none',
      settings: 'none',
      operations: 'view',
    },
    emailMask: 'masked',
  },
  view_only: {
    levels: Object.fromEntries(SCOPE_ITEM_IDS.map((id) => [id, 'view' as const])),
    emailMask: 'masked',
  },
};

/** 3択から permission key の edit/view 集合を組み立てる。 */
export function scopeLevelsToKeys(levels: ScopeLevels): { edit: string[]; view: string[] } {
  const edit: string[] = [];
  const view: string[] = [];
  for (const item of SCOPE_ITEMS) {
    if (item.kind !== 'feature') continue;
    const level = levels[item.id];
    if (level === 'edit') edit.push(...item.keys);
    else if (level === 'view') view.push(...item.keys);
  }
  return { edit, view };
}

/** 保存済み keys から各行のレベルを復元する（編集画面を開いたとき用）。 */
export function keysToScopeLevels(editKeys: string[], viewKeys: string[]): ScopeLevels {
  const levels: ScopeLevels = {};
  for (const item of SCOPE_ITEMS) {
    if (item.kind !== 'feature') continue;
    if (item.keys.every((key) => editKeys.includes(key))) levels[item.id] = 'edit';
    else if (item.keys.every((key) => viewKeys.includes(key) || editKeys.includes(key))) {
      levels[item.id] = 'view';
    } else {
      levels[item.id] = 'none';
    }
  }
  return levels;
}
