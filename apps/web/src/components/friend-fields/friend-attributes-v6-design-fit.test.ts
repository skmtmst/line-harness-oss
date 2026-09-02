import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { balanced, between, element, withoutComments } from './design-fit-slice'
import { filterSavedSearches } from './saved-search-kpis'

/*
 * 設計 `hqrOv` `rIhbN` `QKx8Q` `sfTEW` `XBkiQ` の直しを見張る。
 *
 * **ファイル全体を `toContain` で見ない。** 全体で見ると、直したい行を
 * 消しても、注釈や別の場所に同じ言葉が残っているだけで素通りする。
 * 実際にこの直しでも「表示先」を見出しから外したのに、直しの理由を書いた
 * 注釈が同じ言葉を含むせいで既存の試験が通ってしまった。
 * ここでは**その関数の本体**と**その要素の中**だけを切り出して見る。
 */

const ROOT = path.resolve(__dirname)
const read = (name: string) => fs.readFileSync(path.join(ROOT, name), 'utf8')
const readWeb = (relative: string) =>
  fs.readFileSync(path.resolve(ROOT, '../../..', relative), 'utf8')

const MARK_LIST = read('mark-list.tsx')
const SAVED_LIST = read('saved-search-list.tsx')
const CSV_DIALOG = read('tag-csv-import-dialog.tsx')
const EDIT_PAGE = readWeb('src/app/tags/searches/edit/page.tsx')

describe('切り出しの道具そのもの', () => {
  it('注釈の中の言葉を本文として拾わない', () => {
    const source = '  // 表示先\n  {/* 表示先 */}\n  <Th>使用先</Th>\n  const url = "https://example.com"'
    expect(withoutComments(source)).not.toContain('表示先')
    expect(withoutComments(source)).toContain('使用先')
    // 行の途中の `//` は消さない。URLまで切ってしまう。
    expect(withoutComments(source)).toContain('https://example.com')
  })

  it('入れ子の波括弧を数えて、関数の本体だけを返す', () => {
    const source = 'function f() {\n  if (x) { return 1 }\n  return 2\n}\nfunction g() { return 3 }'
    expect(balanced(source, 'function f')).toContain('return 2')
    expect(balanced(source, 'function f')).not.toContain('return 3')
  })
})

describe('rIhbN 対応マーク一覧', () => {
  const usageLabel = balanced(MARK_LIST, 'function usageLabel')
  const thead = element(MARK_LIST, 'thead')
  const kindCard = between(MARK_LIST, "title: 'マークの種類'", "title: '未対応'")

  it('使用先の列に、隣の「使用中」と同じ友だちの人数を重ねて出さない', () => {
    expect(usageLabel).not.toContain('友だち')
    expect(usageLabel).toContain('配信${mark.usedIn.broadcasts}件')
    expect(usageLabel).toContain('シナリオ${mark.usedIn.scenarios}件')
  })

  it('使用先が未取得のときは「なし」ではなく「—」を出す', () => {
    expect(usageLabel).toContain("if (mark.usedIn === undefined) return '—'")
    expect(usageLabel.indexOf('undefined')).toBeLessThan(usageLabel.indexOf("'なし'"))
  })

  it('見出しは、その列に実際に出しているもの（使用先）に合わせる', () => {
    expect(thead).toContain('使用先')
    expect(thead).not.toContain('表示先')
    for (const label of ['順番', 'マーク', '使用中', '初期値', '自動変更', '操作']) {
      expect(thead).toContain(label)
    }
  })

  it('帯の「マークの種類・使用中」を、同じ画面の一覧そのものから数える', () => {
    expect(kindCard).toContain('listReady ? items.length : null')
    expect(kindCard).toContain('使用中 ${inUseCount}件')
    // 別の集計口から取ると、表に行があるのに帯が0件のままになる。
    expect(kindCard).not.toContain('stats.marks.total')
    expect(kindCard).not.toContain('stats.marks.inUse')
  })

  it('読めていないときに0件と言い切らず、読めない理由を出す', () => {
    const detail = between(MARK_LIST, 'const listStateDetail', 'return (')
    expect(withoutComments(MARK_LIST)).toContain('const listReady = status === \'ready\'')
    expect(detail).toContain('見る権限がありません')
    expect(detail).toContain('読み込んでいます')
    expect(detail).toContain('読み込めませんでした')
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

  it('設計のツールバー2つを画面に置き、絞った結果を一覧に渡す', () => {
    const toolbar = between(SAVED_LIST, 'type="search"', '</select>')
    expect(toolbar).toContain('placeholder="条件名で検索"')
    expect(toolbar).toContain('使用先：すべて')
    expect(toolbar).toContain('setUsageFilter')
    expect(withoutComments(SAVED_LIST)).toContain('{visible.map((search)')
    expect(withoutComments(SAVED_LIST)).not.toContain('{items.map((search)')
  })

  it('読めていないときに「0 / 50 件」と書かない', () => {
    const limitNote = between(SAVED_LIST, '{ready\n', '</p>')
    expect(limitNote).toContain('ready')
    expect(limitNote).toContain('いまの件数は読み込めていません')
  })
})

describe('sfTEW CSVで一括登録の確認画面', () => {
  const head = between(CSV_DIALOG, "phase === 'preview' || phase === 'saving' ? <>", '</header>')
  const summary = between(CSV_DIALOG, 'className={styles.summary}', 'className={styles.filters}')
  const warnBar = between(CSV_DIALOG, 'className={styles.warnBar}', 'className={styles.footerRow}')

  it('いま見ているのがどのファイルの何行かを見出しの下に出す', () => {
    expect(head).toContain('${fileName')
    expect(head).toContain('行を読み込みました')
  })

  it('4つの数に、その数が何なのかを1行添える', () => {
    for (const detail of [
      'ファイルの行数',
      'そのまま登録されます',
      '同じ名前のタグがあります',
      '直すまで登録されません',
    ]) expect(summary).toContain(detail)
  })

  it('押す前に、同じ名前のタグを上書きしないことと、直す場所を書く', () => {
    expect(warnBar).toContain('同じ名前のタグは上書きしません')
    expect(warnBar).toContain('タグ一覧から編集してください')
    expect(warnBar).toContain('入力確認の${preview.summary.invalid}行は登録されません')
  })
})

describe('XBkiQ 保存した検索の編集', () => {
  const shareField = element(EDIT_PAGE, 'fieldset')

  it('共有範囲のところで、上限と共有すると何が起きるかを先に言う', () => {
    expect(shareField).toContain('保存できるのは50件までです（いま${savedCount}件）')
    expect(shareField).toContain('一斉配信・オートメーションの対象条件からも呼び出せます')
  })

  it('件数を読めていないときは、数を作らずに上限だけ書く', () => {
    expect(shareField).toContain("savedCount === null")
    expect(shareField).toContain("'保存できるのは50件までです。'")
    expect(withoutComments(EDIT_PAGE)).toContain('setSavedCount(searches.success ? searches.data.length : null)')
  })

  it('読込中の言い方を、共通の「読み込んでいます」にそろえる', () => {
    expect(withoutComments(EDIT_PAGE)).not.toContain('読み込み中')
    expect(withoutComments(EDIT_PAGE)).toContain('読み込んでいます')
  })
})
