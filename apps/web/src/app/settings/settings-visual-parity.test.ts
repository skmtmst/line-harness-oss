import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('機能設定の添付デザイン', () => {
  it('見出し操作と必須・通常スイッチの表示を保つ', () => {
    expect(source).not.toContain('適用先：この契約全体')
    expect(source).toContain('初期値に戻す')
    expect(source).toContain('グループごと切替')
    expect(source).toContain('上へ移動')
    expect(source).toContain('下へ移動')
    expect(source).toContain('function LockIcon()')
    expect(source).toContain("item.required ? '必須' : enabled ? 'オン' : 'オフ'")
    expect(source).toContain('disabled={item.required}')
    expect(source).toContain('absolute left-0.5 top-0.5')
  })

  it('並べ替えは項目ごとで、区分をまたがない', () => {
    // 点は「この行は並べ替えの対象」という印。
    expect(source).toContain('function GripIcon()')
    // ↑↓ は行に付く。区分の見出しには付けない。
    expect(source).toContain('aria-label={`${item.label}を上へ`}')
    expect(source).toContain('aria-label={`${item.label}を下へ`}')
    expect(source).not.toContain('aria-label={`${group.label}を上へ`}')
    // 端では押せない。
    expect(source).toContain('canMoveUp={index > 0}')
    expect(source).toContain('canMoveDown={index < group.items.length - 1}')
    // 保存は区分ごとの並びとして送る。
    expect(source).toContain('sidebarItemOrder: currentOrder')
  })

  it('クリックできる操作は指、無効な操作は禁止カーソルで統一する', () => {
    expect(source).toContain("total === 0 ? 'cursor-default' : 'cursor-pointer'")
    expect(source).toContain('h-7 w-7 cursor-pointer')
    expect(source).toContain('min-h-10 cursor-pointer rounded-lg')
    expect(source).toContain('min-h-10 cursor-pointer items-center')
    expect(source).toContain('disabled:cursor-not-allowed')
  })

  it('サイドメニューの見え方は、左で決めた並びをそのまま出す', () => {
    expect(source).toContain('この印はメニューに表示されません')
    expect(source).toContain('項目が非表示になります')
    // 別に並べ直さない。保存前と保存後で姿が変わらないようにする。
    expect(source).toContain('<SidebarPreview groups={groups} features={features} />')
    expect(source).not.toContain('PREVIEW_SECTIONS')
    expect(source).not.toContain('サイドメニューの見え方</h2>')
    expect(source).not.toContain('保存前</span>')
  })
})
