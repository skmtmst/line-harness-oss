import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 リッチメニュー削除確認 szXsT', () => {
  it('管理画面とLINE上の削除を共通確認窓へ寄せる', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).toContain('designNode="szXsT"')
    expect(PAGE).toContain("setDeleteTarget({ kind: 'managed', group })")
    expect(PAGE).toContain("setDeleteTarget({ kind: 'external', menu })")
    expect(PAGE.match(/\bconfirm\(/g) ?? []).toHaveLength(0)
  })

  it('管理画面外のメニューは追加・上書き・LINE側への影響を確認してから取り込む', () => {
    expect(PAGE).toContain('data-qa-open="TL7tp"')
    expect(PAGE).toContain('管理画面に追加するもの：')
    expect(PAGE).toContain('上書きするもの：')
    expect(PAGE).toContain('すでに管理中のメニューは重ねて取り込みません。')
    expect(PAGE).toContain('LINE上に残るもの：')
    expect(PAGE).toContain('busy={importBusy}')
    expect(PAGE).toContain('error={importError ?? undefined}')
    expect(PAGE).toContain('setImportedMenuName(res.data?.name ?? menu.name)')
    expect(PAGE).toContain('LINE上の表示は変更していません。管理画面で編集できるようになりました。')
  })

  it('公開中のメニューもブラウザ標準alertを使わず、取り下げの順番を窓で案内する', () => {
    expect(PAGE).toContain('setPublishedDeleteTarget(group)')
    expect(PAGE).toContain('data-qa-open={g.status === \'published\' ? \'szXsT-published\' : \'szXsT\'}')
    expect(PAGE).toContain('は先にLINEから取り下げてください')
    expect(PAGE).toContain('いまは削除していません。')
    expect(PAGE).toContain('「編集」→「危険な操作」→「LINEから取り下げ」')
    expect(PAGE).toContain('LINE上の表示、管理画面の設定、これまでのタップ記録は変更していません。')
    expect(PAGE).toContain('cancelLabel="閉じる"')
    expect(PAGE).not.toContain('「${group.name}」は LINE に登録されています。\\n\\n')
  })

  it('何が消え、何が残り、元に戻せないかを読み合わせる', () => {
    expect(PAGE).toContain('消えるもの：')
    expect(PAGE).toContain('残るもの：')
    expect(PAGE).toContain('元に戻せません。')
    expect(PAGE).not.toContain('(richMenuId:')
  })

  it('APIの成否を確認し、失敗時は窓内の安全な文へ置き換える', () => {
    expect(PAGE).toContain("const [deleteBusy, setDeleteBusy] = useState(false)")
    expect(PAGE).toContain("const [deleteError, setDeleteError] = useState<string | null>(null)")
    expect(PAGE).toContain("if (!res.success) throw new Error('delete_failed')")
    expect(PAGE).toContain('setDeleteError(richMenuError(e, action))')
    expect(PAGE).toContain('if (!deleteTarget || deleteBusy) return')
    expect(PAGE).toContain('busy={deleteBusy}')
    expect(PAGE).toContain('error={deleteError ?? undefined}')
  })
})
