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
