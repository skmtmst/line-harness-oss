export interface AutomationTabCounts {
  rules: number;
  commonActions: number;
  templates: number;
}

export interface MediaTabCounts {
  total: number;
  byKind: Record<'image' | 'video' | 'audio' | 'file', number>;
  unused: number;
  archived: number;
}

export interface ConversionApprovalCounts {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}
