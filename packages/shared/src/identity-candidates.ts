/** V6 3-2-A / 23-1-A が共有する、本人照合候補の読み取り契約。 */
export type IdentityCandidateKind = "friend_duplicate" | "ec_member";

export type IdentityCandidateStatus =
  | "pending"
  | "linked"
  | "different"
  | "deferred"
  | "invalidated";

export type IdentityCandidateDecision = "linked" | "different" | "deferred";

export type IdentityEvidenceStrength = "strong" | "medium" | "weak";

export type IdentityConfidenceLabel = "very_high" | "high" | "medium" | "low";

export type IdentityReprocessMode =
  | "future_only"
  | "analytics_snapshot"
  | "non_delivery_actions";

export interface IdentityCandidateAttribute {
  label: string;
  /** 平文のメール・電話ではなく、画面へ出してよいマスク済みの値。 */
  valuePreview: string | null;
  verified: boolean;
}

export interface IdentityCandidateSubject {
  kind: "friend" | "ec_event";
  /** API操作用。画面本文へは表示しない。 */
  id: string;
  label: string;
  detail: string | null;
  lineAccountId: string | null;
  lineAccountName: string | null;
  shopKey: string | null;
  attributes: IdentityCandidateAttribute[];
}

export interface IdentityCandidateEvidence {
  key: string;
  label: string;
  strength: IdentityEvidenceStrength;
  verified: boolean;
  /** 根拠を読むためのマスク済み補足。元の識別子は返さない。 */
  valuePreview: string | null;
}

export interface IdentityCandidateImpactMetric {
  key: string;
  label: string;
  /** null は未取得。0とは別の意味を持つ。 */
  value: number | null;
  unit: string;
  note: string | null;
}

export interface IdentityCandidateHistoryItem {
  id: string;
  fromStatus: IdentityCandidateStatus;
  toStatus: IdentityCandidateStatus;
  actorName: string;
  reason: string;
  decidedAt: string;
  reprocessMode: IdentityReprocessMode | null;
}

export interface IdentityCandidateDetail {
  id: string;
  kind: IdentityCandidateKind;
  status: IdentityCandidateStatus;
  version: number;
  confidence: {
    score: number;
    label: IdentityConfidenceLabel;
  };
  left: IdentityCandidateSubject;
  right: IdentityCandidateSubject;
  evidence: IdentityCandidateEvidence[];
  impact: IdentityCandidateImpactMetric[];
  history: IdentityCandidateHistoryItem[];
  detectedAt: string;
  reviewedAt: string | null;
  canDecide: boolean;
  canUndo: boolean;
  undoNote: string;
}

export interface IdentityCandidateListItem {
  id: string;
  kind: IdentityCandidateKind;
  status: IdentityCandidateStatus;
  version: number;
  confidence: IdentityCandidateDetail["confidence"];
  left: IdentityCandidateSubject;
  right: IdentityCandidateSubject;
  evidenceSummary: string[];
  detectedAt: string;
  reviewedAt: string | null;
}

export interface IdentityCandidateList {
  items: IdentityCandidateListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface DecideIdentityCandidateRequest {
  expectedVersion: number;
  decision: IdentityCandidateDecision;
  reason: string;
  /** EC照合だけで使用する。指定が無ければ過去イベントへ副作用を起こさない。 */
  reprocess?: {
    mode: IdentityReprocessMode;
    from: string | null;
    to: string | null;
  };
}

export interface UndoIdentityCandidateRequest {
  expectedVersion: number;
  reason: string;
}
