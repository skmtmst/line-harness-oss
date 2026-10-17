


export type AnalyticsMetricState =
  | 'available'
  | 'pending'
  | 'unavailable'
  | 'insufficient'
  | 'partial'
  | 'failed';

export interface AnalyticsMetric<T> {
  value: T | null;
  state: AnalyticsMetricState;
  reason: string | null;
}

export interface AnalyticsOverviewContext {
  lineAccountId: string;
  timeZone: string;
  fromDate: string;
  toDate: string;
  from: string;
  toExclusive: string;
  dataCutoffAt: string;
}

export interface ReactionCampaign {
  id: string;
  name: string;
  kind: 'broadcast' | 'scenario';
  sentAt: string;
  targetPeople: AnalyticsMetric<number>;
  delivered: AnalyticsMetric<number>;
  // 監査 R225: シナリオは「届いた人数」が取れず、手元にあるのは
  // 送信ログの通数だけ。人数と通数を同じ列で出すと読み違えるので、
  // 通数はこの欄に分けて持つ（一斉配信は人数で数えるため null）。
  sentMessages: AnalyticsMetric<number>;
  opened: AnalyticsMetric<number>;
  lineClicked: AnalyticsMetric<number>;
  outcomes: AnalyticsMetric<number>;
  fetchedAt: string | null;
}

export interface AnalyticsRouteOverviewItem {
  id: string;
  refCode: string | null;
  name: string;
  clicks: AnalyticsMetric<number>;
  friendAdds: AnalyticsMetric<number>;
  currentFriends: AnalyticsMetric<number>;
  reactionPeople: AnalyticsMetric<number>;
  conversions: {
    approved: AnalyticsMetric<number>;
    pending: AnalyticsMetric<number>;
    rejected: AnalyticsMetric<number>;
    revenue: AnalyticsMetric<number>;
  };
  adCost: AnalyticsMetric<number>;
  costPerFriend: AnalyticsMetric<number>;
  costPerConversion: AnalyticsMetric<number>;
  profitAfterAdCost: AnalyticsMetric<number>;
}

export interface EventCoverage {
  state: AnalyticsMetricState;
  reason: string | null;
  availableFrom: string | null;
}

export interface UsageCategoryInput {
  key: string;
  label: string;
  href: string;
  created: number | null;
  inUse: number | null;
  lastUsedAt: string | null;
  state?: AnalyticsMetricState;
  reason?: string | null;
  brokenReferences: AnalyticsMetric<number>;
}

export interface UsageReferenceHealthRow {
  templates_broken: number;
  scenarios_broken: number;
  forms_broken: number;
  rich_menus_broken: number;
  friend_attributes_broken: number;
  inflow_conversion_broken: number;
  automations_broken: number;
  unsupported_consumer_types: string | null;
}

export type UsageReferenceHealth = Record<string, AnalyticsMetric<number>>;

/**
 * 機能ごとの「使われ方」の正本（N-448）。
 *
 * featureId は共有カタログ(@line-crm/shared の FEATURE_CATALOG)の正本IDで、
 * 画面側はこのIDで機械照合する。IDを推測で作らない。
 * - unit: バッジに出す回数の単位。機能ごとの「使う」に合わせる
 *   （配信・応答・タップ・回答…）。未計測なら null。
 * - basis: 'last90days' は直近90日の回数、'current' は現在の利用数、
 *   null は計測できない機能（unmeasuredReason を出す）。
 * - unmeasuredReason: 計測できない理由。推測で 0 にしない。
 * - note: 数え方の注意（一部だけを数えている等）。あるとき partial として出す。
 * - lastUsedReason: 最終利用を計測できない理由。あるとき最終利用は未取得で返す。
 */
export interface FeatureUsageDefinition {
  unit: string | null;
  basis: 'last90days' | 'current' | null;
  unmeasuredReason?: string;
  note?: string;
  lastUsedReason?: string;
}

export interface FeatureUsageMeasure {
  count: number | null;
  lastUsedAt: string | null;
  failed: boolean;
}
