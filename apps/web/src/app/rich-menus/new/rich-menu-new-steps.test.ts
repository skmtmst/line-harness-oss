import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'page.tsx'), 'utf8')
const form = readFileSync(join(here, '..', '..', '..', 'components', 'rich-menus', 'rich-menu-create-form.tsx'), 'utf8')

describe('V6 リッチメニュー作成 XtfO3', () => {
  it('実Nodeと3段の現在地を画面から共通部品へ渡す', () => {
    expect(page).toContain('data-design-node="XtfO3"')
    expect(page).toContain("import RichMenuCreateForm")
    expect(form).toContain("import StepTrail from '@/components/shared/step-trail'")
    expect(form).toContain('label="リッチメニュー作成の進み方"')
    expect(form).toContain("{ label: '形とボタン', state: 'current' }")
    expect(form).toContain("{ label: '誰に出すか', state: 'todo' }")
    expect(form).toContain("{ label: '公開のしかた', state: 'todo' }")
  })

  it('面ごとの設定ボタンでその面の編集を開く', () => {
    expect(form).toContain('onClick={() => openAreaEditor(index)}')
    expect(form).toContain('setEditingAreaIndex(index)')
    expect(form).toContain('editingAreaIndex === index')
  })
})
