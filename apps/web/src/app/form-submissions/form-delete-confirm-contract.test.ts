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

  it('消えるもの・残るもの・元に戻せないことを明記する', () => {
    expect(PAGE).toContain('フォームの質問・公開設定・集まった回答を削除します。')
    expect(PAGE).toContain('回答から友だち情報欄やタグへ反映済みの内容は残ります。')
    expect(PAGE).toContain('この操作は元に戻せません。')
  })

  it('実行中の二重押しとダイアログを閉じる操作を止める', () => {
    expect(PAGE).toContain('if (!deleteTarget || deleting || !selectedAccountId) return')
    expect(PAGE).toContain('busy={deleting}')
    expect(PAGE).toContain('if (deleting) return')
  })

  it('APIが失敗したときは成功扱いせず安全な日本語をダイアログ内に出す', () => {
    expect(PAGE).toContain('if (!result.success) throw new Error')
    expect(PAGE).toContain('この回答フォームを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    expect(PAGE).toContain('error={deleteError}')
  })

  it('成功時は削除したカードを外し、開いていた回答も閉じる', () => {
    expect(PAGE).toContain('current.filter((form) => form.id !== targetId)')
    expect(PAGE).toContain('if (selectedFormId === targetId)')
    expect(PAGE).toContain('submissionRequest.current += 1')
    expect(PAGE).toContain('setSelectedFormId(null)')
    expect(PAGE).toContain('setSubmissions([])')
    expect(PAGE).toContain('setSubmissionTotal(0)')
    expect(PAGE).toContain('setDetailSubmission(null)')
  })
})
