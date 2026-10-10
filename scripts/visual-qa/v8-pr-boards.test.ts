import { describe, expect, it } from 'vitest'
// @ts-expect-error JS tool
import { selectPrBoards } from './v8-pr-boards.mjs'
import map from './v8-design-map.json'

describe('ROOT-10 共通の変更の撮影漏れ', () => {
  it.each(['components/shared/button.module.css', 'components/templates/list-page.tsx', 'components/layout/sidebar.tsx', 'app/globals.css'])('%s だけでも全PC板を対象にする', file => {
    const selected: string[] = selectPrBoards([`apps/web/src/${file}`], map.boards)
    const expected = Object.entries(map.boards).filter(([, b]) => b.width && b.route).map(([id]) => id)
    expect(selected.sort()).toEqual(expected.sort())
  })
  it('取り除いた共通部品も対象にする', () => {
    expect(selectPrBoards(['apps/web/src/components/shared/deleted.tsx'], map.boards).length).toBeGreaterThan(0)
  })
  it('試験ファイルだけは影響のない変更として扱う', () => {
    expect(selectPrBoards(['apps/web/src/components/shared/button.test.tsx'], map.boards)).toEqual([])
  })
  it('pageの変更は、その入口の全タブと幅を選ぶ', () => {
    expect(selectPrBoards(['apps/web/src/app/tags/page.tsx'], map.boards).sort()).toEqual(
      Object.entries(map.boards).filter(([, b]) => b.route === '/tags').map(([id]) => id).sort())
  })
})
