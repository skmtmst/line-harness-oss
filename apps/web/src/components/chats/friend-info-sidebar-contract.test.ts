import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SIDEBAR = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'friend-info-sidebar.tsx'),
  'utf8',
)

/** 右パネルの表示設定（設計 `Xi4x9` 2-4）。 */
describe('右パネルの表示項目', () => {
  it('項目ごとに出し入れできる', () => {
    expect(SIDEBAR).toContain('hiddenSections')
    expect(SIDEBAR).toContain('type="checkbox"')
  })

  it('全部隠しても戻せる', () => {
    /*
     * 項目を全部隠すと右パネルが空になり、どれを隠したかも画面から
     * 読めなくなる。戻す道が無いと直せない。
     */
    expect(SIDEBAR).toContain('初期状態に戻す')
    expect(SIDEBAR).toContain('setHiddenSections([])')
  })

  it('いま何件隠しているかを言う', () => {
    // 0件を「隠しています」と書かない。
    expect(SIDEBAR).toContain('すべて表示しています')
    expect(SIDEBAR).toContain('件を隠しています')
  })
})

describe('未取得の書き方', () => {
  it('半角ハイフンで書かない', () => {
    // 半角の `-` は「値が入っていない」ではなく、マイナスや区切りに見える。
    expect(SIDEBAR).not.toMatch(/return '-'/)
    expect(SIDEBAR).not.toMatch(/\|\| '-'/)
    expect(SIDEBAR).toContain("return '—'")
  })
})
