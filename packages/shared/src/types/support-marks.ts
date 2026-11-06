/** 対応マーク */
export interface SupportMark {
  archivedAt?: string | null;
  displayLocations?: import('../support-mark-display.js').SupportMarkLocation[];
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  autoOnInbound: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt?: string;
  version?: number;
  /** 旧環境から共有されているマーク。編集時に選択中アカウントへ複製される。 */
  isInherited?: boolean;
  /** GET /api/support-marks の一覧で返る実参照数。省略は未取得、0は参照なし。 */
  usedIn?: {
    broadcasts: number;
    scenarios: number;
    autoReplies: number;
    savedSearches: number;
    automations: number;
  };
  /** 一覧で示す自動変更の要約。未取得時は autoOnInbound だけで判定する。 */
  automaticChangeLabel?: string;
  /** このマークを選べる・確認できる画面。 */
  displayTargets?: Array<"inbox" | "friend_list" | "friend_detail" | "dashboard" | "broadcast" | "automation">;
}
