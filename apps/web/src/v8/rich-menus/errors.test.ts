/*
 * src/v8/rich-menus/errors.ts の試験。元の app/rich-menus/rich-menu-errors.ts は、
 * rich-menu-safe-errors-contract.test.ts がソースの文字列で見ている（2026-10-06 時点）。
 * そこで見ている中身（権限・不存在・競合・混雑を次の行動が分かる文にする／操作ごとに別の文／
 * 内部のエラー文をそのまま出さない）を、こちらは関数を呼んで確かめる。
 * 元の試験は切り替えの日まで残す。中身を変えるときは両方を直す。
 */
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'
import { richMenuError, richMenuErrorAll, type RichMenuAction } from './errors'

const ACTIONS: RichMenuAction[] = ['load', 'reorder', 'delete', 'unpublish', 'externalDelete', 'import']

describe('V8 リッチメニューのエラー表示', () => {
  it('APIの内部エラーを画面へそのまま出さない', () => {
    const internal = new Error('D1_ERROR: no such column: rich_menu_groups.sort_order')
    for (const action of ACTIONS) {
      expect(richMenuError(internal, action)).not.toContain('D1_ERROR')
    }
    expect(richMenuError(new ApiError(500, 'LINE 公式アカウントの状態取得に失敗しました: 500'), 'load'))
      .not.toContain('状態取得に失敗しました:')
  })

  it('権限・不存在・競合・混雑を次の行動が分かる文にする', () => {
    expect(richMenuError(new ApiError(403, 'Forbidden'), 'load')).toBe('このLINEアカウントのリッチメニューを操作する権限がありません。')
    expect(richMenuError(new ApiError(404, 'Not Found'), 'reorder')).toContain('一覧を読み直してください。')
    expect(richMenuError(new ApiError(409, 'Conflict'), 'reorder')).toContain('一覧を読み直してから')
    expect(richMenuError(new ApiError(429, 'Too Many Requests'), 'import')).toContain('混み合っています')
  })

  it('削除の競合は「使用中」と言い、ほかの競合とは分ける', () => {
    expect(richMenuError(new ApiError(409, 'Conflict'), 'delete')).toContain('使用中のため削除できませんでした')
    expect(richMenuError(new ApiError(409, 'Conflict'), 'externalDelete')).toContain('使用中のため削除できませんでした')
    expect(richMenuError(new ApiError(409, 'Conflict'), 'unpublish')).not.toContain('使用中')
  })

  it('一覧・並び替え・削除・取り下げ・LINEからの削除・取り込みを別の文にする', () => {
    const texts = ACTIONS.map((action) => richMenuError(new Error('network'), action))
    expect(new Set(texts).size).toBe(ACTIONS.length)
    expect(richMenuError(new Error('network'), 'load')).toContain('リッチメニューを読み込めませんでした。')
    expect(richMenuError(new Error('network'), 'import')).toContain('LINE上のリッチメニューを取り込めませんでした。')
  })

  it('複製は専用の文（競合は読み直しを促す）', () => {
    expect(richMenuErrorAll(new ApiError(409, 'Conflict'), 'duplicate')).toContain('複製がほかの操作と重なりました')
    expect(richMenuErrorAll(new Error('network'), 'duplicate')).toBe('リッチメニューを複製できませんでした。もう一度お試しください。')
    expect(richMenuErrorAll(new ApiError(403, 'Forbidden'), 'load')).toBe(richMenuError(new ApiError(403, 'Forbidden'), 'load'))
  })
})
