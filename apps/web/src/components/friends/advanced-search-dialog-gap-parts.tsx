import type { FriendListParams } from '@/lib/api'
import type { FriendSearchBlock as Block, FriendSearchEditorState } from './saved-search-utils'

export const BLOCK_HELP: Record<Block['kind'], string> = {
  name: 'LINE登録名・本名・システム表示名',
  tag: '含む／含まない',
  field: '項目と値',
  status_message: 'ひとことに含む文字',
  created_at: '期間を指定',
  chat_status: '固定の4状態',
  visit_count: '直近 1 年の来店',
  purchase_amount: '直近 1 年の購入（返金後）',
  last_activity_at: '期間外の来店・購入も含む最後の日',
  member_tier: '会員ランクの段',
}


export interface AdvancedSearchResult {
  params: Pick<
    FriendListParams,
    | 'search'
    | 'tagIds'
    | 'excludeTagIds'
    | 'metadata'
    | 'metadataNot'
    | 'statusMessage'
    | 'createdFrom'
    | 'createdTo'
    | 'chatStatus'
    | 'visibility'
    | 'sort'
    | 'limit'
    | 'savedSearchId'
    | 'conditions'
  >
  /** 画面に「絞り込み中」を出すための、人が読める形 */
  summary: string[]
  /**
   * 詳細条件をもう一度開いたとき、この編集状態から再開する（FRIEND-32）。
   * URL直指定の保存検索など実条件が手元に無い適用では未設定のままにし、
   * 開いたときに保存済み一覧から引き直す。
   */
  editorState?: FriendSearchEditorState
}
