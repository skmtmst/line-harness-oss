import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '../../v8/rich-menus/list.tsx'), 'utf8')

/**
 * ★管理画面 `Xn1Mz`。
 * 検索は共通 ListToolbar の1行目、2行目は左に絞り込み・右端に並び順と表示件数。
 * 検索の言葉・並ぶ順・一覧の口へ渡すことは src/v8/rich-menus/list-ops-react.test.tsx が画面を動かして見る。
 * ここには裸の全幅の検索欄に戻さない禁止の見張りだけを残す。
 */
describe("リッチメニューの検索行（★既存の見た目 Xn1Mz）", () => {
  it('検索を横いっぱいに伸ばさない（裸の全幅 input を置かない）', () => {
    expect(PAGE).not.toContain('data-search-row')
    expect(PAGE).not.toContain('type="search"')
    expect(PAGE).not.toMatch(/<SearchField[\s\S]*?className="w-full"/)
  })
})
