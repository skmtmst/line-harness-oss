import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../../v8/auto-replies/list.tsx', import.meta.url), 'utf8')

describe('V6 自動応答の削除確認 Gy9OK', () => {
  it('ブラウザ標準confirmではなく共通の確認ダイアログを使う', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).not.toContain("confirm('このルールを削除しますか？')")
  })

  it('消すルールの名前と、止まる動作、残る履歴を読む', () => {
    expect(PAGE).toContain('displayName(pendingDelete.item)')
  })

  it('削除に失敗したら完了扱いにせず、確認画面の中に理由を出す', () => {
    expect(PAGE).toContain('if (!result.success)')
    expect(PAGE).toContain('error={deleteError}')
  })

  it('処理中は閉じたり二重実行したりできない', () => {
    expect(PAGE).toContain('busy={deleting}')
    expect(PAGE).toContain('if (deleting) return')
  })

  it('対象を選んだアカウントを固定し、切替後に古い対象を削除・再読込しない', () => {
    expect(PAGE).toContain('setPendingDelete({ item: r, accountId: selectedAccountId })')
    expect(PAGE).toContain('pendingDelete.accountId !== selectedAccountId')
    expect(PAGE).toContain('const targetId = pendingDelete.item.id')
    expect(PAGE).toContain('selectedAccountIdRef.current === requestAccountId')
  })
})
