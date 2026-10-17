import type { ApiFieldErrors } from '../api-field-errors.js';

// =============================================================================
// API レスポンスラッパー型
// =============================================================================

/**
 * 汎用 API レスポンス型
 * 成功時は data を持ち、失敗時は error メッセージを持つ
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
