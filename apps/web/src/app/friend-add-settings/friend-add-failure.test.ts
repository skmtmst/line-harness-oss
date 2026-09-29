import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { describeFriendAddFailure } from './friend-add-failure'

/**
 * M006・M009〜M011: 失敗の理由を区別する。「通信を確認して」は通信断だけ。
 */
describe('友だち追加まわりの失敗文', () => {
  it('403は権限、404は対象なし、409の案内はサーバ文をそのまま出す', () => {
    expect(describeFriendAddFailure(new ApiError(403, 'API error: 403'), '実行結果', 'load')).toEqual({
      status: 403,
      message: '実行結果を見る権限がありません。オーナーか管理者に権限の追加を依頼してください。',
    })
    expect(describeFriendAddFailure(new ApiError(404, 'API error: 404'), '実行結果', 'load')).toEqual({
      status: 404,
      message: '実行結果が見つかりません。削除されたか、別のLINEアカウントの記録です。一覧から選び直してください。',
    })
    // 409 の本文（回復案内）は捨てずに出す（フォルダ重複・再試行中など）。
    expect(describeFriendAddFailure(new ApiError(409, '同じ名前のフォルダがあります'), 'フォルダ', 'create')).toEqual({
      status: 409,
      message: '同じ名前のフォルダがあります',
    })
  })

  it('削除・再試行の403も権限と分かる', () => {
    expect(describeFriendAddFailure(new ApiError(403, 'API error: 403'), '設定', 'delete').message).toContain('削除する権限がありません')
    expect(describeFriendAddFailure(new ApiError(403, 'API error: 403'), '失敗した処理', 'retry').message).toContain('再試行する権限がありません')
  })

  it('500は時間をおいての案内、通信断（ふつうのError）は通信の確認だけ', () => {
    expect(describeFriendAddFailure(new ApiError(500, 'API error: 500'), '実行詳細', 'load').message).toContain('時間をおいて')
    expect(describeFriendAddFailure(new ApiError(500, 'API error: 500'), '実行詳細', 'load').message).not.toContain('通信を確認')
    const network = describeFriendAddFailure(new TypeError('fetch failed'), '実行詳細', 'load')
    expect(network).toEqual({
      status: null,
      message: '実行詳細を表示できませんでした。通信を確認して、もう一度お試しください。',
    })
  })

  it('権限・重複で通信確認を求めない', () => {
    for (const caught of [
      new ApiError(403, 'API error: 403'),
      new ApiError(409, '同じ名前のフォルダがあります'),
      new ApiError(404, 'API error: 404'),
    ]) {
      expect(describeFriendAddFailure(caught, '実行結果', 'load').message).not.toContain('通信を確認')
    }
  })
})
