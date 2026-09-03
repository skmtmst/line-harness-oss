import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const MENU = readFileSync(
  join(HERE, '..', '..', 'components', 'chats', 'saved-view-row-menu.tsx'),
  'utf8',
)

/** 保存した検索の一覧（設計 `ASsb3` 2-13）。 */
describe('保存した検索の行', () => {
  it('名前の下に条件を出す', () => {
    /*
      名前だけ並んでいると、どれを押せばよいか名前から推測することになる。

      **要約に渡す前に、必ず形をそろえる。** 受信箱より前に作られた保存は
      `{ all: [], any: [] }` の形で入っていて、そのまま読むと落ちる。
      `normalizeSavedViewConditions` を通さない書き方を通すと、
      この試験は「条件が出ている」と言いながら**落ちる画面**を許してしまう。
    */
    expect(PAGE).toContain('savedViewSummary(normalizeSavedViewConditions(view.conditions), operators)')
  })

  it('消すを名前の隣に直に並べない', () => {
    /*
     * 前は赤字の「削除」が名前のすぐ隣にあり、選ぶつもりで押し間違える
     * 並びだった。「…」へ畳む。
     */
    expect(PAGE).not.toMatch(/aria-label=\{`\$\{view\.name\}を削除`\}/)
    expect(PAGE).toContain('<SavedViewRowMenu')
    expect(MENU).toContain('名前を変える')
    expect(MENU).toContain('消す')
  })

  it('消す前に、何が消えて何が残るかを言う', () => {
    expect(PAGE).toContain('この保存した検索だけが消えます')
    expect(PAGE).toContain('この操作は取り消せません')
  })

  it('名前が空のままでは変更できない', () => {
    expect(PAGE).toContain('disabled={renameText.trim().length === 0 || savedViewBusy}')
  })

  it('撮影の押し口を文言ではなく印で持つ', () => {
    expect(MENU).toContain('data-qa-open="ASsb3"')
  })
})
