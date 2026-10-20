import type { MediaDeleteImpact, MediaReplacementImpact } from '@line-crm/shared';
import { type Media } from './primitives.js';


export interface MediaUsage {
  media_id: string;
  ref_kind: string;
  ref_id: string;
  scanned_at: string;
}

/** 削除影響と、その表示を作った同一時点の使用先行。 */
export interface MediaDeleteImpactSnapshot {
  impact: MediaDeleteImpact;
  usages: MediaUsage[];
}

export interface MediaReplacementPlan {
  source: Media;
  replacement: Media;
  usages: MediaUsage[];
  impact: Omit<MediaReplacementImpact, 'revision'>;
}

export type NamedReference = {
  name: string;
  account_id: string | null;
  account_ids?: string | null;
  asset_kind?: string | null;
  owner_id?: string | null;
};

/** 差し替えの実行範囲。'all' は全使用先、'replaceable' は置換可能な使用先だけ。 */
export type MediaReplacementApplyScope = 'all' | 'replaceable';

export interface MediaReplacementApplyResult {
  /** 使用先の本文を書き換えた行数の合計。 */
  changedRows: number;
  /** 差し替えた使用台帳の件数（snapshot上の対象数）。 */
  appliedUsageCount: number;
  /** 置換不可として元メディアを指したまま残した使用台帳の件数。 */
  skippedUsageCount: number;
  /** 実際に実行した範囲。'all' は全件、'partial' は置換可能分だけ。 */
  mode: 'all' | 'partial';
}

export type MediaUsageReferenceMode = 'live' | 'pinned' | 'mixed' | 'unknown' | 'unavailable';

export interface MediaUsageReferenceState {
  mode: MediaUsageReferenceMode;
  /** pinned のとき参照している版。混在・判別不能・使用先不明は null。 */
  versionNo: number | null;
}

export interface UsageContentRow {
  /** 複数のLINEアカウントで共有している正本。この画面からは書き換えない。 */
  shared: boolean;
  columns: Record<string, string>;
}

export type MediaUsageReferenceErrorCode =
  | 'media_usage_not_found'
  | 'media_usage_shared'
  | 'media_reference_unsupported'
  | 'media_version_not_found'
  | 'media_reference_stale'
  | 'media_metadata_conflict';

export interface MediaUsageScanState {
  sourceIndex: number;
  lastRefId: string;
  cycleStartedAt: string;
}
