import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('テンプレート一覧のV8削除ガード', () => {
  const page = read("../../v8/templates/list.tsx")
  const detail = read("../../v8/template-detail/detail.tsx")

  it('参照中は強制削除せず、使用先を確認させる', () => {
expect(page).toContain('if (t.usageCount > 0)')
    expect(page).toContain('setBlockedDelete({ item: t')
    expect(page).toContain('href={row.href}')
    expect(detail).toContain('if (usageCount > 0) setBlockedOpen(true)')
    expect(detail).toContain('open={deleteOpen && usageCount === 0}')
    expect(page + detail).not.toContain('force: true')
  })

  it('削除確認を共通ダイアログで表示し、ブラウザ標準確認へ戻さない', () => {
expect(page).toContain('<Dialog')
    expect(page).toContain('open={pendingDelete !== null}')
    expect(page).toContain('designNode="V6JFnd"')
    expect(detail).toContain('<ConfirmDialog')
    expect(detail).toContain('open={deleteOpen && usageCount === 0}')
    expect(page + detail).not.toMatch(/window.confirm\(/)
  })
})
