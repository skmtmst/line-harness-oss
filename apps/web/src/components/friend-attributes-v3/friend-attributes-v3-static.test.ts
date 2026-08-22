import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', '..')
const view = readFileSync(join(src, 'components', 'friend-attributes-v4', 'friend-attributes-view.tsx'), 'utf8')
const fixture = readFileSync(join(here, 'friend-attributes-v3-static.tsx'), 'utf8')
const css = readFileSync(join(here, 'friend-attributes-v3-static.module.css'), 'utf8')
const page = readFileSync(join(src, 'app', 'tags', 'page.tsx'), 'utf8')
const menu = readFileSync(join(src, 'lib', 'menu.ts'), 'utf8')

describe('友だち属性V4のView・機能分離契約', () => {
  it('/tagsを1本だけ残し、移行用V2・V3ルートを削除する', () => {
    expect(menu).not.toContain("href: '/tags-v2'")
    expect(menu).not.toContain("href: '/tags-v3'")
    expect(existsSync(join(src, 'app', 'tags-v2', 'page.tsx'))).toBe(false)
    expect(existsSync(join(src, 'app', 'tags-v3', 'page.tsx'))).toBe(false)
  })

  it('完成済みViewはpropsだけを描画し、API・状態・Tailwindへ依存しない', () => {
    expect(view).toContain('export interface FriendAttributesViewProps')
    expect(view).toContain('data-design-node="xn98K"')
    expect(view).not.toContain("@/lib/api")
    expect(view).not.toMatch(/use(State|Effect|Memo|Callback)/)
    expect(view).not.toMatch(/className="[^"]*(?:text-|bg-|rounded-|flex|grid)/)
    expect(view).toContain('friend-attributes-v3-static.module.css')
  })

  it('/tagsはデータ取得と操作だけを持ち、完成済みViewへpropsを渡す', () => {
    expect(page).toContain('FriendAttributesView')
    for (const contract of ['api.tags.list', 'api.tagGroups.list', 'api.listStats.get', 'api.tags.setGroup', 'api.tags.reorder', 'api.tags.update', 'api.tags.delete', 'api.tags.create']) {
      expect(page).toContain(contract)
    }
    expect(page).not.toContain('TagsPageV4')
    expect(page).not.toContain('FriendFieldList')
    expect(page).not.toContain('SupportMarkList')
    expect(page).not.toContain('SavedSearchList')
  })

  it('旧一覧JSXを削除し、静的比較も同じViewへpropsを渡す', () => {
    expect(existsSync(join(src, 'components', 'friend-fields', 'tags-page-v4.tsx'))).toBe(false)
    expect(existsSync(join(src, 'components', 'friend-attributes-v2', 'tag-list-v2.tsx'))).toBe(false)
    expect(fixture).toContain('<FriendAttributesView')
  })

  it('Pencilの生値をCSS Moduleと変数で保持する', () => {
    for (const value of ['font-size: 31px', 'font-weight: 750', 'border-radius: 9px', '--v3-accent: #08c654']) {
      expect(css).toContain(value)
    }
    expect(css).toContain('@media (max-width: 1500px)')
  })
})
