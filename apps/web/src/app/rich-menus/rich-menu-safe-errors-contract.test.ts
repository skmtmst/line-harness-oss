import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 リッチメニューのエラー表示', () => {
  it('APIの内部エラーを画面や警告へそのまま出さない', () => {
    expect(PAGE).toContain("import { api, ApiError } from '@/lib/api'")
    expect(PAGE).toContain("setError(richMenuError(e, 'load'))")
    expect(PAGE).not.toContain('e instanceof Error ? e.message : String(e)')
    expect(PAGE).not.toContain('LINE 公式アカウントの状態取得に失敗しました:')
  })

  it('権限・不存在・競合・混雑を次の行動が分かる文にする', () => {
    expect(PAGE).toContain('error.status === 403')
    expect(PAGE).toContain('error.status === 404')
    expect(PAGE).toContain('error.status === 409')
    expect(PAGE).toContain('error.status === 429')
    expect(PAGE).toContain('一覧を読み直してください。')
  })

  it('一覧・並び替え・削除・LINEからの削除・取り込みを別の文にする', () => {
    for (const action of ['load', 'reorder', 'import']) {
      expect(PAGE).toContain(`richMenuError(e, '${action}')`)
    }
    expect(PAGE).toContain(
      "deleteTarget.kind === 'managed' ? 'delete' : 'externalDelete'",
    )
    expect(PAGE).toContain('setDeleteError(richMenuError(e, action))')
    expect(PAGE).toContain('リッチメニューを読み込めませんでした。')
    expect(PAGE).toContain('LINE上のリッチメニューを取り込めませんでした。')
  })
})
