import { FEATURE_CATALOG, FEATURE_IDS, type FeatureId } from '@line-crm/shared';


/** 受け付けるIDは共有カタログそのもの。画面・Workerで別の配列を持たない。 */
export const TOGGLEABLE_FEATURES: readonly FeatureId[] = FEATURE_IDS;

export const TOGGLEABLE_FEATURE_SET = new Set<string>(TOGGLEABLE_FEATURES);

export type ToggleableFeature = FeatureId;

export const SETTING_PREFIX = 'feature.';

export const SIDEBAR_ORDER_KEY = 'sidebar.order';

export /**
 * 区分の中の項目の並び。`{ 区分の目印: [項目の目印, ...] }`。
 *
 * 区分の並び（sidebar.order）とは別に持つ。1つにまとめると、項目を1つ
 * 動かすたびに区分の並びまで書き直すことになり、片方の保存が古いときに
 * もう片方まで巻き戻る。
 */
const SIDEBAR_ITEM_ORDER_KEY = 'sidebar.item_order';

export const PARENT_CHILD_MODE_KEY = 'organization.parent_child_enabled';

export const SPECIALIZED_CATALOG_KEY = 'feature.specialized.catalog';

export const FEATURE_SETTINGS_BUNDLE_KEY = 'feature.settings_bundle_v1';

export type FeatureSettingsData = {
  features: Record<string, boolean>;
  sidebarOrder: string[] | null;
  sidebarItemOrder: Record<string, string[]> | null;
};

export type FeatureSettingsState = FeatureSettingsData & { version: number };

export type FeatureVisibilityData = {
  /**
   * サイドバーに項目を出せるかだけを返す。会社の保存値、契約、依存理由は
   * 管理情報なので、一般staff向けの応答へ混ぜない。
   */
  features: Record<FeatureId, boolean>;
};

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

export function isToggleable(key: unknown): key is ToggleableFeature {
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

export function settingIsEnabled(raw: string | null): boolean {
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

export type FeatureImpactItemWithIds = FeatureImpactItem & {
  /** 対象行ID(並び替え済み)。応答用で上限を超えたら先頭分だけ。 */
  ids: string[];
  /** 上限を超えて応答のIDが欠けているか。 */
  truncated: boolean;
  /**
   * 照合用の全対象ID(並び替え済み、上限なし)。確認トークンの
   * fingerprintにだけ使い、応答には含めない。
   */
  fingerprintIds: string[];
};

export type FeatureImpact = {
  feature: ToggleableFeature;
  items: FeatureImpactItemWithIds[];
  /** 確認トークンなしでは保存できない影響があるか。 */
  blocking: boolean;
};

export /** 確認トークンの置き場。汎用設定表の1行で足り、移行は要らない。 */
const OFF_CONFIRM_KEY = 'feature.off_confirm';

export /** 確認から保存までの持ち時間。稼働中は変わるため短めにする。 */
const OFF_CONFIRM_TTL_MS = 10 * 60 * 1000;

export type OffConfirmation = {
  token: string;
  impactHash: string;
  version: number;
  expiresAt: number;
};

export /**
 * 一斉配信のアカウント結び付け。複数アカウント宛て(重複除き)は
 * account_ids の JSON 配列にも対象が入る。一覧取得と同じ条件。
 */
const BROADCAST_ACCOUNT_SCOPE = `(b.line_account_id = ?
  OR (b.target_type = 'multi-account-dedup' AND b.account_ids IS NOT NULL
    AND EXISTS (SELECT 1 FROM json_each(b.account_ids) WHERE value = ?)))`;

export /**
 * 回答フォームの影響範囲。結び付けが無いフォームは表示上は全アカウントに
 * 出るが、持ち主が分からないため影響には加算しない(実readerと意図的に
 * 違う。影響は「このアカウントが止める仕事」だけ数える)。
 */
const FORM_ACCOUNT_SCOPE = `EXISTS (SELECT 1 FROM form_accounts fa WHERE fa.form_id = f.id AND fa.line_account_id = ?)`;

/**
 * 切替対象の網羅表。各機能が「何を数えるか」か
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
  /**
   * FROM〜WHERE。件数とID取得で共有し、条件ずれを防ぐ。
   * dispatcherのclaim条件と同じ述語にする。
   */
  fromWhere: string;
  /** ID列(主表のid)。保存時に対象集合を固定するために使う。 */
  idColumn: string;
  /** ? の個数。すべて accountId で埋める。 */
  params: 1 | 2;
};

export /**
 * 1項目あたりの応答に載せる対象IDの上限。照合用の fingerprintIds は
 * 上限なしの全IDで、101件目以降の入れ替えも検出する。
 */
const IMPACT_IDS_LIMIT = 100;

export type FeatureImpactCoverageEntry =
  | { readonly scope: 'counted'; readonly sources: readonly FeatureImpactSource[] }
  | { readonly scope: 'none'; readonly reason: string };
