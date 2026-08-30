import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/** 共通情報の削除確認（設計 `yPkWe` 14-1-A）。 */
describe('共通情報の削除確認', () => {
  it('ブラウザ標準の確認ではなく共通ダイアログを使う', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).not.toContain('confirm(')
    expect(PAGE).toContain('data-qa-open="yPkWe"')
  })

  it('使用先を確認できた未使用の共通情報だけを確認画面へ進める', () => {
    expect(PAGE).toContain('api.commonVars.deleteImpact(id, selectedAccountId)')
    expect(PAGE).toContain('const blocked = impacts.filter(({ impact }) => !impact.canDelete)')
    expect(PAGE).toContain('setDeleteTargets(targets)')
  })

  it('削除する名前と件数を題で確認できる', () => {
    expect(PAGE).toContain('「${deleteTargets[0]?.name ?? \'\'}」を削除しますか？')
    expect(PAGE).toContain('ほか${deleteTargets.length - 1}件を削除しますか？')
  })

  it('消えるもの・残るもの・元に戻せないことを伝える', () => {
    expect(PAGE).toContain('登録値・次回予約を削除します。')
    expect(PAGE).toContain('テンプレート、配信、フォルダ、友だちは削除しません。')
    expect(PAGE).toContain('この操作は元に戻せません。')
  })

  it('削除中は二重操作と確認画面の終了を止める', () => {
    expect(PAGE).toContain('if (deleteTargets.length === 0 || !selectedAccountId || deleting) return')
    expect(PAGE).toContain('busy={deleting}')
    expect(PAGE).toContain('if (deleting) return')
  })

  it('APIが失敗を返したら成功扱いにしない', () => {
    expect(PAGE).toContain('if (!result.success) throw new Error(result.error)')
  })

  it('失敗しても窓を閉じず、削除できなかったものだけを残す', () => {
    expect(PAGE).toContain('setDeleteTargets(failed)')
    expect(PAGE).toContain('削除できなかったものだけを残しています。')
    expect(PAGE).toContain('error={deleteError}')
  })
})
