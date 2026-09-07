import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('V6回答フォーム削除確認 gBp2J', () => {
  it('共通の確認ダイアログで対象名を読み合わせる', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).toContain('<ConfirmDialog')
    expect(PAGE).toContain('displayFormName(deleteTarget.name)')
    expect(PAGE).toContain('回答フォームを削除')
  })

  it('影響確認を先に読み、公開中・回答あり・利用中はアーカイブへ分ける', () => {
    expect(PAGE).toContain('api.forms.deleteImpact(form.id, selectedAccountId)')
    expect(PAGE).toContain('公開状態・回答数・利用中の場所を確認しています。')
    expect(PAGE).toContain('deleteImpact.submissionCount')
    expect(PAGE).toContain('deleteImpact.referenceCount')
    expect(PAGE).toContain('開けなくなる公開URL')
    expect(PAGE).toContain("await api.forms.archive(targetId, selectedAccountId, deleteImpact.revision)")
  })

  it('実行中の二重押しとダイアログを閉じる操作を止める', () => {
    expect(PAGE).toContain('if (!deleteTarget || !deleteImpact || deleting || stopping || !selectedAccountId) return')
    expect(PAGE).toContain('busy={deleting || stopping || deleteImpactLoading}')
    expect(PAGE).toContain('if (deleting || stopping) return')
  })

  it('APIが失敗したときは成功扱いせず安全な日本語をダイアログ内に出す', () => {
    expect(PAGE).toContain('if (!result.success) throw new Error')
    expect(PAGE).toContain('この回答フォームをアーカイブできませんでした。状態を読み直してから、もう一度お試しください。')
    expect(PAGE).toContain('error={deleteError}')
  })

  it('受付だけ止めるときは回答と一覧を残す', () => {
    expect(PAGE).toContain('受付だけ止める（おすすめ）')
    expect(PAGE).toContain("api.forms.update(deleteTarget.id, selectedAccountId, { isActive: false })")
    expect(PAGE).toContain("form.id === deleteTarget.id ? { ...form, isActive: false } : form")
  })

  it('成功時は削除したカードを外す（回答の閲覧は専用ルートが担うため一覧に戻さない）', () => {
    expect(PAGE).toContain('current.filter((form) => form.id !== targetId)')
    expect(PAGE).toContain('setDeleteTarget(null)')
    expect(PAGE).not.toContain('selectedFormId')
    expect(PAGE).not.toContain('setSubmissions')
  })
})
