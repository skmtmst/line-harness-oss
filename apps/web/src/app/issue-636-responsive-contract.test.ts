import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Issue #636（レスポンシブ違反4画面＋友だち一覧）の構造契約。
 * 実幅の計測はブラウザが要るため、ここでは「はみ出し・圧潰を起こした
 * 幅制約クラス」を固定する。
 *
 * 監査実測（Musecode返却5）:
 *  - 04-C-横1 /tags: 1440pxでも min-w-[880px] が表の実幅833pxを超え47px横スクロール
 *  - 08-C-狭1 /auto-replies: 390pxで検索欄が w=57 まで圧縮
 *  - 09-C-横1 /friend-add-settings: min-width 860px が枠834pxを超え26pxスクロール
 *    ＋ lg未満でページ全体が約880pxにはみ出し
 *  - 10-C-狭1 /webinars: 390pxで検索欄が w=41 まで圧潰
 *  - 03-C-はみ1 /friends: 768/390pxで検索行右端がviewport外
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('04-C-横1: 友だち属性のタグ表は1440pxに収まる', () => {
  const page = read('../components/friend-fields/tags-page-v4.tsx')

  it('表の最小幅を内容実幅（833px）以下の800pxへ下げる', () => {
    expect(page).toContain('min-w-[800px]')
    expect(page).not.toContain('min-w-[880px]')
  })

  it('狭い幅で情報を落とさない逃げ道（表だけ横スクロール）は残す', () => {
    expect(page).toContain('overflow-x-auto')
  })
})

describe('08-C-狭1 / 10-C-狭1: 狭幅で検索欄を実用幅に保つ', () => {
  /*
   * 帯は flex-wrap 済みだが、min-w-0 の入力は縮む側になるため
   * 390pxで実用幅を割いていた。min-w-45（180px）を下限にすると
   * 入力が1行を占め、並び順・表示件数は次の行へ折り返す。
   */
  const cases = [
    ['auto-replies/page.tsx', '自動応答'],
    ['webinars/page.tsx', 'ウェビナー'],
  ] as const

  for (const [path, name] of cases) {
    it(`${name}の検索帯は折り返し前提で、検索欄は min-w-45 を下限にする`, () => {
      const page = read(path)
      expect(page).toContain('flex flex-wrap items-center gap-2 border p-3')
      expect(page).toContain('min-w-45 flex-1')
      expect(page).not.toContain('min-w-0 flex-1 border px-3 py-2 text-sm')
    })
  }
})

describe('03-C-はみ1: 友だち一覧の検索行は収まらない分を折り返す', () => {
  const page = read('friends/page.tsx')

  it('検索フォームに flex-wrap を付ける', () => {
    expect(page).toContain('flex min-w-0 flex-wrap items-center gap-2.5')
  })

  it('各行の操作幅（詳細条件110・保存した検索130・並び順210・検索70）は変えない', () => {
    for (const width of ['w-27.5', 'w-32.5', 'w-52.5', 'w-17.5']) {
      expect(page).toContain(width)
    }
  })
})

describe('09-C-横1: 友だち追加時配信の表は1440pxに収まる', () => {
  const page = read('friend-add-settings/page.tsx')

  it('表の最小幅を枠の実幅（834px）以下の720pxへ下げる', () => {
    expect(page).toContain('[data-scroll-table] table { min-width: 720px; }')
    expect(page).not.toContain('min-width: 860px')
  })

  it('lg未満の単列トラックを明示し、一覧セクションは min-w-0 で縮める', () => {
    expect(page).toContain('grid-cols-[minmax(0,1fr)]')
    expect(page).toMatch(/<section data-design="Rule"[^>]*className="min-w-0"/)
  })

  it('狭くなった表で操作列が切れないよう固定幅を当てる', () => {
    expect(page).toMatch(/<Th title="状態" className="w-24">/)
    expect(page).toMatch(/<Th title="直近7日の友だち追加数" className="w-24">/)
    expect(page).toMatch(/<Th title="操作" className="w-40">/)
  })

  it('行リンクは1行省略＋titleで全文を確認できる（設計ルールどおり）', () => {
    expect(page).toContain('block truncate font-bold" title={rule.name}')
  })
})
