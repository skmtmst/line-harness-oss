import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/** 一斉配信の削除確認（設計 `EGMb1` 6-1-I）。 */
describe('一斉配信の削除確認', () => {
  it('ブラウザ標準の確認ではなく共通ダイアログを使う', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).not.toContain("confirm('この配信を削除してもよいですか？')")
  })

  it('削除する配信名を確認できる', () => {
    expect(PAGE).toContain('title={`「${deleteTarget?.title ?? \'\'}」を削除しますか？`}')
  })

  it('予約中の配信が中止され、取り消せないことを伝える', () => {
    expect(PAGE).toContain('予約中の配信は中止され、この操作は取り消せません。')
  })

  it('削除中は二重操作を止める', () => {
    expect(PAGE).toContain('busy={deletingId !== null}')
    expect(PAGE).toContain('if (deletingId !== null) return')
  })

  it('APIが失敗を返したら成功扱いにしない', () => {
    expect(PAGE).toContain('if (!result.success) throw new Error(result.error)')
  })

  it('失敗しても窓を閉じず、内部用のエラー文を出さない', () => {
    expect(PAGE).toContain('この配信を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    expect(PAGE).toContain('error={deleteError}')
  })
})

describe('一覧の未取得表示', () => {
  const source = PAGE

  it('未取得を半角ハイフンで書かない', () => {
    /*
     * 半角の `-` は「値が入っていない」ではなく、マイナスや区切りに見える。
     * 設計（`q76C35`）は全角の `—`。実値0とも見分けが付かなくなる。
     */
    expect(source).not.toMatch(/return '-'/)
    expect(source).not.toMatch(/\n\s*'-'\n/)
    expect(source).toContain("return '—'")
  })

  it('権限不足を読み込み失敗と別の1枚にする', () => {
    expect(source).toContain('kind="forbidden"')
    expect(source).toContain('err.status === 403')
  })
})
