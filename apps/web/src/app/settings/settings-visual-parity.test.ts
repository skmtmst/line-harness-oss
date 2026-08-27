import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('機能設定の添付デザイン', () => {
  it('見出し操作と必須・通常スイッチの表示を保つ', () => {
    expect(source).not.toContain('適用先：この契約全体')
    expect(source).not.toContain('<h1')
    expect(source).toContain("mode === 'features' ? 'c4R6F' : 'qNpAZ'")
    expect(source).toContain('機能を初期値に戻す')
    expect(source).toContain('グループごと切替')
    expect(source).toContain('function LockIcon()')
    expect(source).toContain("item.required ? '必須' : enabled ? 'オン' : 'オフ'")
    expect(source).toContain('locked={item.required}')
    expect(source).toContain("import Toggle from '@/components/shared/toggle'")
  })

  it('表示設定と並べ替えを別URLに分け、区分をまたがない', () => {
    expect(source).toContain('href="/settings?view=order"')
    expect(source).toContain("params.get('view') === 'order'")
    expect(source).toContain('function GripIcon()')
    expect(source).toContain("mode === 'order' && <span")
    expect(source).toContain('aria-label={`${item.label}を上へ`}')
    expect(source).toContain('aria-label={`${item.label}を下へ`}')
    expect(source).not.toContain('aria-label={`${group.label}を上へ`}')
    expect(source).toContain('canMoveUp={index > 0}')
    expect(source).toContain('canMoveDown={index < group.items.length - 1}')
    expect(source).toContain('sidebarItemOrder: currentOrder')
  })

  it('クリックできる操作は指、無効な操作は禁止カーソルで統一する', () => {
    expect(source).toContain("total === 0 ? 'cursor-default' : 'cursor-pointer'")
    expect(source).toContain('h-7 w-7 cursor-pointer')
    expect(source).toContain('<Button')
    expect(source).toContain('disabled:cursor-not-allowed')
  })

  it('サイドメニューの見え方は、左で決めた並びをそのまま出す', () => {
    expect(source).toContain('この印はメニューに表示されません')
    expect(source).toContain('項目が非表示になります')
    // 別に並べ直さない。保存前と保存後で姿が変わらないようにする。
    expect(source).toContain("mode === 'order' && <SidebarPreview groups={groups} features={features} />")
    expect(source).not.toContain('PREVIEW_SECTIONS')
    expect(source).not.toContain('サイドメニューの見え方</h2>')
    expect(source).not.toContain('保存前</span>')
  })
})
