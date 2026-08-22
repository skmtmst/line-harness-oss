import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const component = readFileSync(join(here, 'friend-attributes-v3-static.tsx'), 'utf8')
const css = readFileSync(join(here, 'friend-attributes-v3-static.module.css'), 'utf8')
const page = readFileSync(join(here, '..', '..', 'app', 'tags-v3', 'page.tsx'), 'utf8')
const menu = readFileSync(join(here, '..', '..', 'lib', 'menu.ts'), 'utf8')

describe('友だち属性V3の静的デザイン契約', () => {
  it('V2の入口を外し、V3の入口と独立ページを用意する', () => {
    expect(menu).not.toContain("href: '/tags-v2', label: '友だち属性V2'")
    expect(menu).toContain("href: '/tags-v3', label: '友だち属性V3'")
    expect(page).toContain('FriendAttributesV3Static')
  })

  it('Pen.dev実ノードと一覧画面の骨格を記録する', () => {
    expect(component).toContain('data-design-node="xn98K"')
    for (const section of ['Head', 'Tabs', 'KPIs', 'Actions', 'Folder', 'Toolbar', 'QuickFilters', 'Table', 'Pagination']) {
      expect(component).toContain(`data-design="${section}"`)
    }
  })

  it('API・既存V2部品・共通画面部品を読み込まない', () => {
    for (const forbidden of ['@/lib/api', 'friend-attributes-v2', 'friend-fields', '@/components/shared']) {
      expect(component).not.toContain(forbidden)
    }
    expect(component).not.toContain('onClick=')
    expect(component).not.toContain('styles.sidebar')
  })

  it('V3専用CSSで1920pxと1440pxの配置を持つ', () => {
    expect(component).toContain("./friend-attributes-v3-static.module.css")
    expect(css).not.toContain('.sidebar')
    expect(css).toContain('@media (max-width: 1500px)')
  })
})
