import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('テンプレート一覧のV6画面構造', () => {
  const page = read('page.tsx')
  const detail = read('detail/page.tsx')

  it('参照中は強制削除せず、使用先を確認させる', () => {
    expect(page).toContain('使用先を見る')
    expect(page).toContain('使用中は削除できません。差し替え後にもう一度この画面から操作してください。')
    expect(page).not.toContain('削除すると参照がクリアされます')
    for (const usage of ['scenarioSteps', 'reminderSteps', 'richMenuAreas', 'trackedLinks']) {
      expect(page).toContain(usage)
    }
    expect(detail).toContain('disabled={usageCount > 0}')
    expect(detail).toContain('使用中のため削除できません')
    expect(detail).not.toContain('削除すると、その箇所の本文が空になります')
  })

  it('M9cijの削除確認を共通ダイアログで表示し、ブラウザ標準確認へ戻さない', () => {
    expect(page).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(detail).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(page).toContain('data-design-node="M9cij"')
    expect(detail).toContain('data-design-node="M9cij"')
    expect(page).toContain('open={pendingDelete !== null}')
    expect(detail).toContain('open={deleteOpen && usageCount === 0}')
    expect(page + detail).not.toContain("confirm('このテンプレートを削除しますか？')")
  })
})
