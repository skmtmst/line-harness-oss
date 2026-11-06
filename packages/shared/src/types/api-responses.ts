import type { ApiFieldErrors } from '../api-field-errors.js';

// =============================================================================
// API レスポンスラッパー型
// =============================================================================

/**
 * 既存の呼出元用の互換表示。fetchApiはHTTP失敗をApiErrorとして投げる。
 * 通信上の4xx/5xxはapi-errors.tsのApiErrorResponseを使う。
 * 2xxの業務状態と、既存の内部ハンドラの組立て用の型を保つ。
 */
export type ApiResponse<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
      /** 入力欄の名前と、人に表示する理由。旧APIでは省略される。 */
      fields?: ApiFieldErrors;
      /** バリデーションエラー等の詳細 (任意) */
      details?: Record<string, string[]>;
    };

/**
 * ページネーション付き API レスポンス型
 * エラーハンドリングが必要な場合は ApiResponse<PaginatedResponse<T>> として使う。
 * 例: `ApiResponse<PaginatedResponse<Friend>>`
 */
export interface PaginatedResponse<T> {
  /** データ一覧 */
  items: T[];
  /** 総件数 */
  total: number;
  /** 現在のページ番号 (1始まり) */
  page: number;
  /** 1ページあたりの件数 */
  limit: number;
  /** 次ページが存在するか */
  hasNextPage: boolean;
}
