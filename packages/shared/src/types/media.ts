/** メディアライブラリの1件 */
export interface MediaItem {
  revision?: number;
  id: string;
  lineAccountId: string | null;
  folderId: string | null;
  kind: "image" | "video" | "audio" | "file";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string;
  uploadedBy: string | null;
  /**
   * 入れた人の表示名（R35）。uploadedBy は内部ID（UUID）のまま残し、
   * 画面にはこちらを出す。退職・削除済みで引けないときは null。
   */
  uploadedByName?: string | null;
  createdAt: string;
  /** アーカイブ済みなら退避した時刻・実行者・理由。使用中でも触れない消去ではない。 */
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
  /**
   * 運用者が記録した利用期限（YYYY-MM-DD）。null/省略は未記録＝不明。
   * 推定値は入れない（根拠のない権利情報を作らない）。
   */
  usageExpiresAt?: string | null;
  /** 同意・権利について確認済みの記録メモ。null/省略は未記録＝不明。 */
  usageConsentNote?: string | null;
  /** 0は未使用。省略は旧APIなどでまだ取得できていない状態。 */
  usageCount?: number;
}

/** メディアの使用箇所 */
export interface MediaUsage {
  refKind: string;
  refId: string;
  scannedAt: string;
}

export type MediaDeleteImpactReferenceKind =
  | "template"
  | "broadcast"
  | "rich_menu"
  | "scenario_step"
  | "nen_column"
  | "event"
  | "webinar"
  | "booking_menu"
  | "booking_staff"
  | "booking_settings";

/** 登録メディアを消す前に、運用者が確認する現在の使用先。 */
export interface MediaDeleteImpactReference {
  kind: MediaDeleteImpactReferenceKind;
  /** 権限内で現在の正本を引けたときだけ入る。内部IDは画面へ返さない。 */
  name: string | null;
  /** 同じLINEアカウントの使用先へ移動できるときだけ入る。 */
  href: string | null;
  /** 参照先が削除済み、または別アカウントで詳細を見せられない場合。 */
  state: "available" | "unavailable";
  scannedAt: string;
}

/** `GET /api/media/:id/delete-impact` の返り値。 */
export interface MediaDeleteImpact {
  media: {
    id: string;
    filename: string;
    kind: MediaItem["kind"];
  };
  usageCount: number;
  references: MediaDeleteImpactReference[];
  /** すべての使用先を削除直前に読み切った時刻。0件でも必ず入る。 */
  checkedAt: string;
  lastScannedAt: string | null;
  /**
   * すべての使用先を読み切れたか（R34）。表が無い環境などで一部を読めな
   * かったときは false。false のとき usageCount 0 は「どこでも使って
   * いない」ではなく「確かめられなかった」で、canDelete も false
   * （確かめられないものは消させない）。
   */
  verified: boolean;
  canDelete: boolean;
  recommendedAction: "delete" | "review_references";
}

export type MediaReplacementBlocker =
  | "same_media"
  | "different_kind"
  | "unavailable_reference"
  | "shared_reference"
  | "unsupported_reference";

/** 一括差し替えの対象になる使用先。内部IDは画面へ返さない。 */
export interface MediaReplacementReference extends MediaDeleteImpactReference {
  replaceable: boolean;
  blocker: MediaReplacementBlocker | null;
  reason: string | null;
}

/** `GET /api/media/:id/replacement-impact` の返り値。 */
export interface MediaReplacementImpact {
  source: MediaDeleteImpact["media"];
  replacement: MediaDeleteImpact["media"];
  usageCount: number;
  replaceableCount: number;
  /** この画面からは差し替えられない使用先の件数。usageCount - replaceableCount と同じ。 */
  blockedCount: number;
  /** 差し替えられない使用先の種類別件数（ウェビナー何件・共有配信何件…）。 */
  blockedByKind: Partial<Record<MediaDeleteImpactReferenceKind, number>>;
  references: MediaReplacementReference[];
  blockers: MediaReplacementBlocker[];
  /** 全使用先をまとめて差し替えられるときだけ true。 */
  canReplace: boolean;
  /**
   * 差し替え可能な使用先だけを選んで実行できるとき true。
   * 差し替え元と先の組み合わせ自体が不正（同一・種類違い）な場合は false。
   */
  canPartiallyReplace: boolean;
  checkedAt: string;
  /** 影響確認後に使用先が変わっていないことを、実行直前に照合する値。 */
  revision: string;
}

export interface MediaReplacementResult {
  sourceId: string;
  replacementId: string;
  /** 全使用先を替えたか（all）、差し替え可能な箇所だけを替えたか（partial）。 */
  mode: "all" | "partial";
  replacedUsageCount: number;
  /** 置換不可として元メディアを指したまま残した使用先の件数。 */
  skippedUsageCount: number;
  remainingUsageCount: number | null;
  verification: "verified" | "partial" | "unavailable";
  checkedAt: string;
}
