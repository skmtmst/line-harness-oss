import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/auto-replies/page.tsx'), 'utf8')

describe('V6 自動応答の削除確認 Gy9OK', () => {
  it('ブラウザ標準confirmではなく共通の確認ダイアログを使う', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).toContain('data-design-node="Gy9OK"')
    expect(PAGE).not.toContain("confirm('このルールを削除しますか？')")
  })

  it('消すルールの名前と、止まる動作、残る履歴を読む', () => {
    expect(PAGE).toContain('pendingDelete?.name || pendingDelete?.keyword')
    expect(PAGE).toContain('新しく届くメッセージへの自動返信')
    expect(PAGE).toContain('タグ付けなどの後続処理が止まります')
    expect(PAGE).toContain('過去の実行履歴は削除されません')
  })

  it('削除に失敗したら完了扱いにせず、確認画面の中に理由を出す', () => {
    expect(PAGE).toContain('if (!result.success)')
    expect(PAGE).toContain('error={deleteError}')
    expect(PAGE).toContain('状態を読み直してからお試しください')
  })

  it('処理中は閉じたり二重実行したりできない', () => {
    expect(PAGE).toContain('busy={deleting}')
    expect(PAGE).toContain('if (deleting) return')
  })
})
