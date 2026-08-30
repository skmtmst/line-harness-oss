import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 リッチメニュー削除確認 szXsT', () => {
  it('管理画面とLINE上の削除を共通確認窓へ寄せ、取り込みの確認は残す', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).toContain('designNode="szXsT"')
    expect(PAGE).toContain("setDeleteTarget({ kind: 'managed', group })")
    expect(PAGE).toContain("setDeleteTarget({ kind: 'external', menu })")
    expect(PAGE).toContain('「${menu.name}」を管理画面に取り込みます。')
    expect(PAGE.match(/\bconfirm\(/g)).toHaveLength(1)
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
