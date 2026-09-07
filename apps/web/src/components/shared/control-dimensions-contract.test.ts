import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Pencil V6 の入力・選択・押し口規定', () => {
  it('役割ごとの高さと白背景を共通部品で維持する', () => {
    const button = read('./button.module.css')
    const formControls = read('./form-controls.module.css')
    const select = read('./select-field.module.css')
    const search = read('./search-field.module.css')

    expect(button).toMatch(/\.standard\s*{[^}]*height:\s*36px/s)
    expect(button).toMatch(/\.field\s*{[^}]*height:\s*40px/s)
    expect(formControls).toMatch(/\.control\s*{[^}]*background:\s*var\(--color-canvas\)/s)
    expect(formControls).toMatch(/\.input\s*{[^}]*height:\s*40px/s)
    expect(select).toMatch(/\.select\s*{[^}]*height:\s*42px/s)
    expect(select).toMatch(/background-color:\s*var\(--color-canvas\)/)
    expect(select).toMatch(/background-position:\s*right 13px center/)
    expect(search).toMatch(/\.search\s*{[^}]*height:\s*42px/s)
    expect(search).toMatch(/background:\s*var\(--color-canvas\)/)
  })

  it('素の選択欄にも高さ・白背景・右12pxの矢印余白を適用する', () => {
    const globals = read('../../app/globals.css')
    const rule = globals.match(/select:not\(\[multiple\]\):not\(\.appearance-none\)\s*{([^}]*)}/s)?.[1]

    expect(rule).toBeDefined()
    expect(rule).toMatch(/min-height:\s*40px/)
    expect(rule).toMatch(/padding-right:\s*36px/)
    expect(rule).toMatch(/background-color:\s*var\(--color-canvas\)/)
    expect(rule).toMatch(/background-position:\s*right 12px center/)
  })

  it('代表的な画面側上書きも規定値に戻す', () => {
    const folderSelect = read('../chats/template-folder-select.tsx')
    const users = read('../users/users-filters.tsx')
    const tags = read('../friend-fields/tags-page-v4.tsx')
    const broadcasts = read('../../app/broadcasts/page.tsx')

    expect(folderSelect).toContain('size="field"')
    expect(users).not.toContain('className="h-9')
    expect(users).toContain('v6-select h-10 min-w-[176px]')
    expect(tags).not.toContain('v6-select-tight h-9')
    expect(tags).toContain('h-10 min-w-[180px] flex-1')
    expect(tags).toContain('h-10 min-w-[176px]')
    expect(tags).toContain('h-10 min-w-[152px]')
    expect(broadcasts).toContain('bg-canvas focus:ring-accent h-10')
  })
})
