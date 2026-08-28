import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/reminders/page.tsx'), 'utf8')

describe('V6 リマインダ削除確認 Y0Sn3', () => {
  it('ブラウザ標準confirmではなく共通ConfirmDialogを使う', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).not.toContain('if (!confirm(')
    expect(PAGE).toContain('data-design-node="Y0Sn3"')
  })

  it('選んだ名前と件数を確認画面へ渡す', () => {
    expect(PAGE).toContain("Pick<Reminder, 'id' | 'name'>")
    expect(PAGE).toContain('deleteTargetLabel')
    expect(PAGE).toContain('選択した${deleteTargets.length}件のリマインダ')
  })

  it('配信予定も消えて取り消せないことを実行前に伝える', () => {
    expect(PAGE).toContain('登録済みの配信予定を削除します。この操作は取り消せません。')
    expect(PAGE).toContain('confirmLabel="リマインダを削除"')
    expect(PAGE).toContain('destructive')
  })

  it('処理中は二度押しと閉じる操作を止める', () => {
    expect(PAGE).toContain('if (deleteTargets.length === 0 || deleteBusy) return')
    expect(PAGE).toContain('busy={deleteBusy}')
    expect(PAGE).toContain('if (deleteBusy) return')
  })

  it('複数削除の成功分と失敗分を分ける', () => {
    expect(PAGE).toContain('succeededIds')
    expect(PAGE).toContain('failedTargets')
    expect(PAGE).toContain('for (const id of succeededIds) next.delete(id)')
    expect(PAGE).toContain('setDeleteTargets(failedTargets)')
  })

  it('失敗しても確認画面を閉じず日本語で次の手を出す', () => {
    expect(PAGE).toContain('件を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    expect(PAGE).toContain('error={deleteError}')
    expect(PAGE).not.toContain('API error:')
  })
})
