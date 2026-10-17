/** 友だち情報欄の種類 */
export type FriendFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "time"
  | "select"
  | "multi_select"
  | "checkbox"
  | "url"
  | "tel"
  | "email"
  | "image"
  | "pdf";

/**
 * 友だち情報欄の項目。
 *
 * フォームの回答 → 情報欄 → 友だち詳細 → テンプレートの差し込み、が
 * 1本の線で繋がる。その起点。
 */
export interface FriendField {
  id: string;
  folderId: string | null;
  /** 画面に出す名前 */
  name: string;
  /** 差し込み変数名。{{field.pet_name}} のように使う */
  fieldKey: string;
  type: FriendFieldType;
  /** select / multi_select のときの選択肢 */
  options: string[] | null;
  /**
   * R139: 選択肢のIDと表示名の対応（サーバーが実行時に付けている）。
   * 既定値（IDの配列・IDで保存）を表示名へ戻すときに使う。無いときは
   * 表示名の突き合わせに倒す。追加のみで既存の形は変えない。
   */
  optionDefinitions?: Array<{ id: string; label: string }> | null;
  defaultValue: string | null;
  source: "manual" | "form" | "ec" | "automation";
  ecFieldPath: string | null;
  /** true ならEC側が正。管理画面からは変更できない */
  ecIsMaster: boolean;
  /** 本名・電話・住所など。閲覧を役割で絞る */
  isPersonal: boolean;
  isStarred: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  status?: "active" | "read_only" | "archived";
  version?: number;
  /** 画像・PDFは本文へ文字として差し込まない。 */
  canInsertText?: boolean;
  /** GET /api/friends/:id/fields のときだけ付く */
  value?: string | null;
  updatedBy?: string | null;
  fixedKey?: import("../fixed-friend-fields").FixedFriendFieldKey | null;
  valueUpdatedAt?: string | null;
  valueSource?: { type: string; id: string | null; name: string | null } | null;
  /** ?withUsage=1 のときだけ付く */
  usageCount?: number;
  /** この項目へ回答を保存する回答フォーム数。未取得時は省略する。 */
  formUsageCount?: number;
  /** 一覧で運用者へ示す表示・利用先。未取得時は省略する。 */
  displayTargets?: string[];
  /** 選択中アカウント専用でなく、移行前からある共通項目。 */
  isInherited?: boolean;
}

export interface FriendFieldListSummary {
  total: number;
  inUse: number;
  registeredFriends: number;
  formLinks: number | null;
  updatedThisMonth: number;
}
