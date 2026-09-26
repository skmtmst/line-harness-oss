import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'tags-page-v4.tsx'), 'utf8')

/*
 * 作るボタンの置き場所の決まり：普段使う作る操作は、一覧のすぐ上の
 * 左の操作の並びにまとめる。見出しの行の右端には置かない。
 * タグ画面では「フォルダを追加」（副）の横に「＋ タグを追加」（主）を
 * 並べ、タブ行の右端にはたまにしか使わない CSV だけを残す。
 */
describe('タグ画面の作る操作の置き場所', () => {
  it('「フォルダを追加」と「＋ タグを追加」が同じ並びに隣り合う', () => {
    const at = SRC.indexOf('href="/tags/folders/new">フォルダを追加')
    expect(at).toBeGreaterThan(-1)
    const row = SRC.slice(at, at + 400)
    // 注記ではなく押せるボタンの実体が隣にあること。
    expect(row).toContain('<Button href="/tags/new" variant="primary">＋ タグを追加</Button>')
  })

  it('タブ行の右端には CSV で一括登録だけが残る', () => {
    const actions = SRC.slice(
      SRC.indexOf('actions={currentTabBlocked'),
      SRC.indexOf("tab === 'marks'"),
    )
    expect(actions).toContain('CSVで一括登録')
    expect(actions).not.toContain('/tags/new')
  })
})
