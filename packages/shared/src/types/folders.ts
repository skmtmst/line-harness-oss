/** 汎用フォルダ */
export interface Folder {
  revision?: number;
  id: string;
  kind: string;
  name: string;
  parentId: string | null;
  displayOrder: number;
  /**
   * #RRGGBB。未設定は null。
   *
   * 色はフォルダに付く。タグ1つずつに色を決めさせると、100枚あるタグで
   * 色がばらけて一覧での区別に使えない。分類の色を、属するタグに出す。
   */
  color: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 選択中アカウントの可視範囲で数えた、このフォルダに属する件数（#631）。
   *
   * `kind` が件数の数え方（対応表・アカウント境界）を確立できていない種別
   * （#730）や `kind` を指定しない呼び出しでは `undefined`。**`undefined`
   * は「0件」ではなく「数えていない」を意味する。**画面はキャストで
   * フォールバック計算をせず、そのまま「—」等を出すこと。
   */
  itemCount?: number;
}
