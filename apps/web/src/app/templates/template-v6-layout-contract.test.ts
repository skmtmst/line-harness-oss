import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('テンプレート一覧のV8削除動作', () => {
  const page = read('../../v8/templates/list.tsx') + read('../../v8/templates/words.ts')
  const detail = read('../../v8/template-detail/detail.tsx')

  it('参照中は強制削除せず、使用先を確認させる', () => {
    expect(page).toContain('使っている所を見る')
    expect(page).toContain('先に別のテンプレートへ差し替えてください。')
    expect(page).not.toContain('削除すると参照がクリアされます')
    for (const usage of ['scenarioSteps', 'reminderSteps', 'richMenuAreas', 'trackedLinks']) {
      expect(page).toContain(usage)
    }
    expect(detail).toContain('if (deleting || usageCount > 0 || !template) return')
    expect(detail).toContain('setBlockedOpen(true)')
    expect(detail).not.toContain('削除すると、その箇所の本文が空になります')
  })

  it('V8の削除確認を共通ダイアログで表示し、ブラウザ標準確認へ戻さない', () => {
    expect(page).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(detail).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(page).toContain('designNode="V6JFnd"')
    expect(detail).toContain('designNode="V6JFnd"')
    expect(page).toContain('open={pendingDelete !== null}')
    expect(detail).toContain('open={deleteOpen && usageCount === 0}')
    expect(page + detail).not.toContain("confirm('このテンプレートを削除しますか？')")
  })
})
