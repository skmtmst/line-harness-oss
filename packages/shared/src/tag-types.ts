// -----------------------------------------------------------------------------
// タグ (Tag)
// -----------------------------------------------------------------------------
export interface Tag {
  /** 主キー (UUIDv4) */
  id: string;
  /** タグ名 */
  name: string;
  /** 表示色 (HEX: #RRGGBB) */
  color: string;
  /** 所属する親分類のID。null は未分類 */
  groupId?: string | null;
  /** このタグを初めて獲得したときに付与するマイル */
  mileageReward?: number;
  /** 紹介された友だちがこのタグを獲得したとき、紹介者へ付与するマイル */
  referralMileageReward?: number;
  /** 今後の行動マイル倍率。10000 = 1.0倍、null = 倍率タグとして使わない */
  mileageMultiplierBps?: number | null;
  /** 複数の倍率タグがある場合の優先順位（大きい値を採用） */
  mileageMultiplierPriority?: number;
  /** 友だち一覧の「★つきタグ」列に出すか */
  isStarred?: boolean;
  /** 一覧での並び順。小さいほど上 */
  displayOrder?: number;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 選択中のLINE公式アカウント。の定義詳細で返る。 */
  lineAccountId?: string | null;
  description?: string | null;
  manualAssignmentAllowed?: boolean;
  reapplyPolicy?: "first_only" | "every_time";
  linkedEnabled?: boolean;
  status?: "active" | "archived";
  /** 楽観ロックに使う定義版。 */
  version?: number;
  updatedAt?: string;
  /** このタグが付与されている友だち数 (GET /api/tags のみ付与) */
  friendCount?: number;
  /** 自動付与のきっかけ。履歴から断定できない場合は省略する。 */
  assignSource?: "ec" | "line_login" | "form" | "ec_purchase" | "manual" | "birthday";
  /** このタグを参照している機能と件数。0件の機能は省略する。 */
  usedIn?: {
    broadcasts?: number;
    forms?: number;
    scenarios?: number;
    autoReplies?: number;
    savedSearches?: number;
  };
  /** このタグが付いた後に動く、マイル以外のアクション数。0件なら省略する。 */
  otherActionCount?: number;
  /** タグ編集画面で再表示する、保存済みの連動アクション。 */
  linkedActions?: Array<{
    id: string;
    type: string;
    label: string;
    timing: string;
  }>;
  /** タグ管理の整理候補に入る理由。withCounts=1 のときだけ返る。 */
  cleanupReasons?: Array<"unused" | "duplicate_name">;
}
