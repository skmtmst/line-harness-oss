import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
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

describe('04-C-横1: タグ表は1440pxに収まる', () => {
  const page = read('../v8/tags/tags-tab.tsx')

  it('表の最小幅を内容実幅（833px）以下の800pxへ下げる', () => {
    expect(page).not.toContain('min-w-[880px]')
    if (page.includes('<DataTable')) {
      // 共通 DataTable へ寄せた後は、表に最小幅を直書きしない。
      // 幅は中身に合わせ、1440pxで横スクロールを出さない。
      const mins = [...page.matchAll(/min-w-\[(\d+)px\]/g)].map((m) => Number(m[1]))
      expect(mins.filter((n) => n > 833), '内容実幅833pxを超える最小幅がある').toEqual([])
      return
    }
    expect(page).toContain('min-w-[800px]')
  })

  it('狭い幅でも名前の色の印から所属フォルダを確認できる', () => {
    expect(page).toContain('<DataTable')
    expect(page).toContain('<FolderDotName folder={group}>')
    const dot = read('../components/shared/folder-dot.tsx')
    expect(dot).toContain("const label = `フォルダ：${folder?.name ?? '未分類'}`")
    expect(dot).toContain('title={label}')
    expect(page).not.toContain('<Th className={styles.colFolder}>')
  })
})

describe('08-C-狭1 / 10-C-狭1: 狭幅で検索欄を実用幅に保つ', () => {
  /*
   * 旧処方は帯の直書き（min-w-45＝180px下限の input）だったが、
   * ★管理画面 `Xn1Mz` で共通 ListToolbar へそろえた。検索は幅320・下限240を
   * 部品が持ち（ListToolbar の契約テストで実数を守る）、狭い幅では
   * 折り返す。画面側に潰れる直書きの検索帯を戻さないことを見る。
   */
  const cases = [
    ['auto-replies/page.tsx', '自動応答'],
    ['webinars/page.tsx', 'ウェビナー'],
  ] as const

  for (const [path, name] of cases) {
    it(`${name}の検索欄は共通部品を使い、狭い幅でも押し潰さない`, () => {
      const page = read(path)
      if (path === 'webinars/page.tsx') {
        // 検索欄は現在の共有道具段が幅を持つ。
        expect(page).toContain('<SearchField')
        expect(page).toContain('<ListToolbar')
      } else {
        expect(page).toContain('<ListToolbar')
      }
      expect(page).not.toContain('type="search"')
      expect(page).not.toContain('data-search-row')
      expect(page).not.toContain('min-w-0 flex-1 border px-3 py-2 text-sm')
    })
  }
})

describe('03-C-はみ1: 友だち一覧の検索行は収まらない分を折り返す', () => {
  const page = read('friends/page.tsx')

  it('V8の検索欄と道具の段は縮められる', () => {
    const page = read('../v8/friends/list/list.tsx')
    const css = read('../v8/friends/list/list.module.css')
    expect(page).toContain('<SearchField')
    expect(page).toContain('<ListToolbarSearchSlot>')
    const toolbarCss = read('../components/shared/list-toolbar.module.css')
    expect(toolbarCss).toMatch(/\.slotsRow\s*\{[^}]*min-width: 0/s)
    expect(toolbarCss).toMatch(/\.searchSlot\s*\{[^}]*flex:\s*0 1 var\(--list-search-width, var\(--tpl-list-search-w\)\)/s)
    expect(toolbarCss).toMatch(/\.searchSlot\s*\{[^}]*min-width: min\(var\(--list-search-width, var\(--tpl-list-search-min\)\), 100%\)/s)
    expect(css).not.toMatch(/min-width:\s*(?:880|1180)px/)
  })
})

// 友だち追加時配信の 管理画面 の720px・列幅・gridクラスは廃止。V8の表示幅は絵との照合で確かめる。
