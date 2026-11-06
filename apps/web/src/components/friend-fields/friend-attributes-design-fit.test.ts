import fs from 'node:fs'
import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { balanced, between, withoutComments } from './design-fit-slice'
import { filterSavedSearches } from './saved-search-kpis'

/*
 * 設計 `hqrOv` `rIhbN` `QKx8Q` `sfTEW` `XBkiQ` の直しを見張る。
 *
 * **ファイル全体を `toContain` で見ない。** 全体で見ると、直したい行を
 * 消しても、注釈や別の場所に同じ言葉が残っているだけで素通りする。
 * 実際にこの直しでも「表示先」を見出しから外したのに、直しの理由を書いた
 * 注釈が同じ言葉を含むせいで既存の試験が通ってしまった。
 * ここでは**その関数の本体**と**その要素の中**だけを切り出して見る。
 *
 * 残すのは禁止の見張りと、絞り込みの関数の試験だけ。画面の動きは描いて押す試験が見る：
 * 対応マーク＝`v8/tags/marks-tab-react.test.tsx`、保存した検索＝`v8/tags/searches-tab-react.test.tsx`・
 * `v8/tag-edit/search-edit-actions.test.tsx`、情報欄＝`app/tags/fields-tab-v8-parity-react.test.tsx`、
 * タグ編集＝`app/tags/edit/edit-page-states.test.tsx`。
 */

const ROOT = path.resolve(__dirname)
const read = (name: string) => fs.readFileSync(path.join(ROOT, name), 'utf8')
const readWeb = (relative: string) =>
  readUiSource(path.resolve(ROOT, '../../..', relative), 'utf8')

const MARK_LIST = readWeb('src/v8/tags/marks-tab.tsx') + read('mark-list.tsx')
const SAVED_LIST = readWeb('src/v8/tags/searches-tab.tsx') + read('saved-search-list.tsx')

describe('切り出しの道具そのもの', () => {
  it('注釈の中の言葉を本文として拾わない', () => {
    const source = '  // 表示先\n  {/* 表示先 */}\n  <Th>使用先</Th>\n  const url = "https://example.com"'
    expect(withoutComments(source)).not.toContain('表示先')
    expect(withoutComments(source)).toContain('使用先')
    // 行の途中の `//` は消さない。URLまで切ってしまう。
    expect(withoutComments(source)).toContain('https://example.com')
    // 関数の冒頭の注釈から、後ろのJSX注釈まで本文ごと消さない。
    expect(withoutComments('function f() { /* 説明 */ return visible.map(fn) }\n{/* 図 */}')).toContain('return visible.map(fn)')
  })

  it('入れ子の波括弧を数えて、関数の本体だけを返す', () => {
    const source = 'function f() {\n  if (x) { return 1 }\n  return 2\n}\nfunction g() { return 3 }'
    expect(balanced(source, 'function f')).toContain('return 2')
    expect(balanced(source, 'function f')).not.toContain('return 3')
  })
})

describe('rIhbN 対応マーク一覧', () => {
  const usageLabel = balanced(MARK_LIST, 'function usageLabel')
  const kindCard = between(MARK_LIST, "title: 'マーク'", "title: '未対応'")

  it('使用先の列に、隣の「使用中」と同じ友だちの人数を重ねて出さない', () => {
    expect(usageLabel).not.toContain('友だち')
  })

  it('帯の「マークの種類・使用中」を、別の集計口から取らない', () => {
    // 別の集計口から取ると、表に行があるのに帯が0件のままになる。
    expect(kindCard).not.toContain('stats.marks.total')
    expect(kindCard).not.toContain('stats.marks.inUse')
  })
})

describe('QKx8Q 保存した検索の一覧', () => {
  it('条件名と使用先で、読み込んだ一覧の中だけを絞る', () => {
    const items = [
      { name: 'VIPかつ未契約', usedIn: [{ kind: 'broadcast' as const, id: 'b1', name: '配信1', mode: 'live' as const }] },
      { name: '離脱注意', usedIn: [] },
      { name: 'VIP 誕生日', usedIn: undefined },
    ]
    expect(filterSavedSearches(items, 'vip', 'all').map((item) => item.name))
      .toEqual(['VIPかつ未契約', 'VIP 誕生日'])
    expect(filterSavedSearches(items, '', 'used').map((item) => item.name))
      .toEqual(['VIPかつ未契約', 'VIP 誕生日'])
    expect(filterSavedSearches(items, '', 'unused').map((item) => item.name))
      .toEqual(['離脱注意', 'VIP 誕生日'])
  })

  it('使用先が未取得の条件を「未使用だけ」の一覧から隠さない', () => {
    // 隠すと、実は配信で使われている条件を未使用として消しにいってしまう。
    const unknown = [{ name: '未取得', usedIn: undefined }]
    expect(filterSavedSearches(unknown, '', 'used')).toHaveLength(1)
    expect(filterSavedSearches(unknown, '', 'unused')).toHaveLength(1)
  })

  it('絞る前の一覧をそのまま表に流さない', () => {
    expect(withoutComments(SAVED_LIST)).not.toContain('{items.map((search)')
  })
})
