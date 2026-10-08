/** 最後に成功した配布の版。未配布を0と混同しない。 */
export interface HqTemplateTargetVersion {
  version: number | null;
  latestVersion: number;
  status: 'latest' | 'older' | 'undistributed';
  label: string;
}

/** 以前のWorker・保存済みfixtureとの互換のため、追加項目は省略可能。 */
export interface HqTemplatePreflightDisplay {
  targetVersion?: HqTemplateTargetVersion;
}
export interface HqTemplateResultDisplay {
  /** 成功時に実際に作った主項目の名前。失敗・処理中・旧記録はnull。 */
  createdName?: string | null;
}

/** 未配布の保存版を下書きとして表示する。配布済みの版は履歴から消さない。 */
export interface HqTemplateVersionDisplay {
  id: string; version: number; created_by: string | null; creator_name: string | null;
  created_at: string; is_draft: boolean; is_current: boolean;
}
export interface HqTemplateReceivedVersion {
  accountId: string; accountName: string; receivedAt: string | null;
  targetVersion: HqTemplateTargetVersion;
}
export interface HqTemplateVersionComparison {
  from: { version: HqTemplateVersionDisplay; definition: unknown };
  to: { version: HqTemplateVersionDisplay; definition: unknown };
  changed: boolean;
}
export interface HqTemplateListStats { thisMonthSentCount: number | null; outdatedTemplateCount: number }
