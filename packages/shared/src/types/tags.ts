import type { TagCsvImportRowCode } from '../tag-import-row-code.js';

/** CSV一括登録で画面からAPIへ渡す1行。lineは見出しを含む元CSVの行番号。 */
export interface TagCsvImportInputRow {
  line?: number;
  name: string;
  folderName?: string;
}

export type TagCsvImportRowStatus =
  | "ready"
  | "created"
  | "skipped"
  | "invalid"
  | "failed";

/** 事前確認・実行結果で共通して返す1行。失敗行CSVを画面で作れる情報を残す。 */
export interface TagCsvImportRowResult {
  line: number;
  name: string;
  folderName: string;
  status: TagCsvImportRowStatus;
  code?: TagCsvImportRowCode;
  message?: string;
  tagId?: string;
}

export interface TagCsvImportSummary {
  total: number;
  ready: number;
  created: number;
  skipped: number;
  invalid: number;
  failed: number;
}

export interface TagCsvImportPreview {
  summary: TagCsvImportSummary;
  rows: TagCsvImportRowResult[];
}

export interface TagCsvImportResult extends TagCsvImportPreview {
  outcome: "success" | "partial" | "failed";
}

/**
 * タグの親分類。「お悩み」「ペット」のようにタグをまとめる。
 * 入れ子にはしない（二段で足りる）。
 */
export interface TagGroup {
  /** 主キー (UUIDv4) */
  id: string;
  /** 所有するLINE公式アカウント。移行前の共通分類だけ null。 */
  accountId: string | null;
  /** 分類名 */
  name: string;
  /** 一覧での並び順。小さいほど上 */
  sortOrder: number;
  /**
   * #RRGGBB。未設定は null。
   *
   * 色はこの分類（フォルダ）に付く。属するタグの印に出る。
   * タグ1つずつに色を決めさせると、100枚あるタグで色がばらけて
   * 一覧での区別に使えない。
   */
  color: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 友だち×タグ 中間テーブル (FriendTag)
// -----------------------------------------------------------------------------
export interface FriendTag {
  /** 友だちID */
  friendId: string;
  /** タグID */
  tagId: string;
  /** 割り当て日時 (ISO 8601) */
  assignedAt: string;
}
