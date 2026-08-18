import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('機能設定の添付デザイン', () => {
  it('見出し操作と必須・通常スイッチの表示を保つ', () => {
    expect(source).toContain('適用先：この契約全体')
    expect(source).toContain('初期値に戻す')
    expect(source).toContain('グループごと切替')
    expect(source).toContain('function LockIcon()')
    expect(source).toContain("item.required ? '必須' : enabled ? 'オン' : 'オフ'")
    expect(source).toContain('disabled={item.required}')
  })

  it('サイドメニューの非表示表現と多店舗管理の最下部配置を保つ', () => {
    expect(source).toContain('この印はメニューに表示されません')
    expect(source).toContain('項目が非表示になります')
    expect(source.indexOf("label: '専用機能'")).toBeLessThan(source.indexOf("label: '多店舗管理'"))
    expect(source).not.toContain('サイドメニューの見え方</h2>')
    expect(source).not.toContain('保存前</span>')
  })
})
