import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8')

/**
 * ★V7 `Xn1Mz`「一覧の上の道具の並び」の全画面統一。
 *
 * - 1行目：検索（幅320・虫眼鏡つき）→ 保存した検索 → この条件を保存。
 *   検索を横いっぱいに伸ばさない。枠付きの箱で包まない。
 * - 2行目：左に絞り込み、右端に並び順と表示件数。表示件数だけの行を作らない。
 * - 行の操作：主な1つ＋「…」。削除・アーカイブ・複製・停止はメニューの中。
 *   ゴミ箱・箱のアイコンだけのボタンを行に直に置かない。
 *
 * 幅の実数（320・下限240）は共通 ListToolbar の契約テストで守る。
 * ここでは「どの画面も共通部品を使い、旧い形に戻さない」ことを守る。
 */

// 道具を共通 ListToolbar へそろえた画面（友だちは例外。後述）。
const TOOLBAR_PAGES = [
  'broadcasts/page.tsx',
  'reminders/page.tsx',
  'scenarios/page.tsx',
  'auto-replies/page.tsx',
  'form-submissions/page.tsx',
  'webinars/page.tsx',
  'events/page.tsx',
  'templates/page.tsx',
  'inflow-links/page.tsx',
  'conversions/page.tsx',
  'common-actions/page.tsx',
  'rich-menus/page.tsx',
  'automations/page.tsx',
  'booking/bookings/page.tsx',
  'contents/page.tsx',
  'friend-add-settings/page.tsx',
  '../components/friend-fields/tags-page-v4.tsx',
] as const

// 行の操作を「主な1つ＋…」へそろえた画面・部品。
const ROW_PAGES = [
  'broadcasts/page.tsx',
  'webinars/page.tsx',
  'rich-menus/page.tsx',
  'friend-add-settings/page.tsx',
  'contents/page.tsx',
  '../components/friend-fields/tags-page-v4.tsx',
  '../components/friend-fields/saved-search-list.tsx',
  '../components/friend-fields/mark-list.tsx',
] as const

describe('一覧の道具と行の操作の統一（★V7 Xn1Mz）', () => {
  it('対象画面は共通 ListToolbar を使う（手で並べない）', () => {
    for (const rel of TOOLBAR_PAGES) {
      const src = read(rel)
      expect(src, `${rel} が ListToolbar を使っていません`).toContain('<ListToolbar')
    }
  })

  it('検索を横いっぱいに伸ばさない（裸の全幅 input・全幅 SearchField を置かない）', () => {
    for (const rel of TOOLBAR_PAGES) {
      const src = read(rel)
      expect(src, `${rel} に裸の検索 input が残っています`).not.toContain('type="search"')
      expect(src, `${rel} に data-search-row が残っています`).not.toContain('data-search-row')
      expect(src, `${rel} に全幅の SearchField が残っています`).not.toMatch(
        /<SearchField[\s\S]{0,400}?className="[^"]*\bw-full\b/,
      )
    }
  })

  it('表示件数は2行目の右（trailing）に置き、単独の行を作らない', () => {
    for (const rel of TOOLBAR_PAGES) {
      const src = read(rel)
      if (!src.includes('aria-label="表示件数"')) continue
      const toolbarAt = src.indexOf('<ListToolbar')
      const trailingAt = src.indexOf('trailing={', toolbarAt)
      expect(trailingAt, `${rel} の表示件数が2行目の右にありません`).toBeGreaterThan(toolbarAt)
      expect(
        src.indexOf('aria-label="表示件数"', trailingAt),
        `${rel} の表示件数が2行目の右にありません`,
      ).toBeGreaterThan(trailingAt)
    }
  })

  it('行にゴミ箱・箱のアイコンだけのボタン（IconButton）を直に置かない', () => {
    for (const rel of ROW_PAGES) {
      const src = read(rel)
      expect(src, `${rel} に行直置きのアイコンボタンが残っています`).not.toContain('<IconButton')
      // 箱・ゴミ箱アイコン（lucide の <Archive …> <Trash2 …>）の JSX 使用を
      // 行ごとに見て、確認の窓の題名アイコン（titleIcon）やメニューの中の
      // icon は許す。<ArchiveReviewBackdrop> のような箱始まりの部品名は
      // そもそも合致しない。
      const directIconRows = src
        .split('\n')
        .filter((line) => /<(Archive|Trash2)[\s>/]/.test(line))
        .filter((line) => !/titleIcon/.test(line))
        .filter((line) => !/icon:\s*</.test(line))
      expect(directIconRows, `${rel} に行直置きの箱・ゴミ箱アイコンが残っています`).toEqual([])
    }
  })

  it('行の削除・保管はメニューの中の危ない操作にする', () => {
    for (const rel of ROW_PAGES) {
      const src = read(rel)
      const hasMenuDelete =
        src.includes("label: '削除する'") ||
        src.includes("label: '保管する'") ||
        src.includes("label: 'アーカイブする'")
      expect(hasMenuDelete, `${rel} の削除・保管がメニューの中にありません`).toBe(true)
    }
  })

  it('友だち一覧は例外：手組みのまま検索幅320・保存と同じ行・並び順は2行目の右', () => {
    // 契約テスト（friends-shared-parts）が SearchField の直接利用を固定しているため、
    // ListToolbar ではなく幅の決まりだけをそろえる。
    const src = read('friends/page.tsx')
    expect(src).toContain("import SearchField from '@/components/shared/search-field'")
    expect(src).toContain('w-80 max-w-full min-w-60 shrink-0')
    expect(src).not.toContain('min-w-60 flex-1 max-sm:basis-full')
  })
})
