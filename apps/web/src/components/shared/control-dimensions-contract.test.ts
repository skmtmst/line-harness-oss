import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Pencil V6 の入力・選択・押し口規定', () => {
  it('役割ごとの高さと白背景を共通部品で維持する', () => {
    const button = read('./button.module.css')
    const formControls = read('./form-controls.module.css')
    const select = read('./select.module.css')
    const selectTsx = read('./select.tsx')
    const search = read('./search-field.module.css')

    /*
     * #976 U083: PC標準の高さは40pxにそろえる（ボタン・入力・検索・選択）。
     * 以前はボタン36px・選択/検索42pxでずれていた。タッチ端末は44px。
     * （`@media (pointer: coarse)` の 44px は design-unification の試験が見る）
     */
    expect(button).toMatch(/\.standard\s*{[^}]*height:\s*40px/s)
    expect(button).toMatch(/\.field\s*{[^}]*height:\s*40px/s)
    expect(formControls).toMatch(/\.control\s*{[^}]*background:\s*var\(--color-canvas\)/s)
    expect(formControls).toMatch(/\.input\s*{[^}]*height:\s*40px/s)
    expect(select).toMatch(/\.trigger\s*{[^}]*height:\s*40px/s)
    expect(select).toMatch(/background:\s*var\(--color-canvas\)/)
    // 開いた候補は DOM に描き、矢印はアイコンで出す（ブラウザ任せにしない）。
    expect(selectTsx).toContain('ChevronDown')
    /*
     * 呼び出し側の幅指定（`size="full"` や utilities レイヤー）が既定幅
     * 176px/128px を上書きできるよう、部品の宣言は components レイヤー
     * に置く。未レイヤーに戻すとレイヤー外が常に勝ち、グリッド枠から
     * プルダウンがはみ出す（予約設定の空き確認で発生）。
     */
    expect(select).toMatch(/@layer components/)
    expect(search).toMatch(/\.search\s*{[^}]*height:\s*40px/s)
    expect(search).toMatch(/background:\s*var\(--color-canvas\)/)
  })

  it('素の選択欄にも高さ・白背景・右12pxの矢印余白を適用する', () => {
    const globals = read('../../app/globals.css')
    const rule = globals.match(/select:not\(\[multiple\]\):not\(\.appearance-none\)\s*{([^}]*)}/s)?.[1]

    expect(rule).toBeDefined()
    expect(rule).toMatch(/min-height:\s*40px/)
    expect(rule).toMatch(/padding-right:\s*36px/)
    expect(rule).toMatch(/background-color:\s*var\(--color-canvas\)/)
    expect(rule).toMatch(/background-position:\s*right 12px center/)
  })

  it('共有部品の CSS Module はすべて components レイヤーに置く', () => {
    /*
     * #718: レイヤーに属さない部品 CSS は utilities レイヤーより常に強く、
     * 呼び出し側の `w-full` や `h-8` がエラーも出さずに無視される
     * （予約設定のプルダウンはみ出し・カレンダー前後ボタンの高さ不整合で発生）。
     * components レイヤーに入れると既定値は部品が持ち、
     * 画面側のクラスは指定したときだけ勝つ。
     */
    const dir = new URL('.', import.meta.url)
    const modules = readdirSync(dir).filter((name) => name.endsWith('.module.css'))
    const offenders = modules.filter((name) => !read(`./${name}`).includes('@layer components'))
    expect(offenders).toEqual([])
  })

  it('部品の CSS Module は先頭で層の順番を宣言する', () => {
    /*
     * Tailwind v4 の出力は層の順番を先頭で宣言しない。部品の CSS が
     * globals.css より先に読まれると、最初に現れた `@layer components` が
     * 1番目の層になり、後から来る base（preflight）が部品に勝つ。
     * ボタンの地・枠・余白、入力欄の枠が全部消えた（検証環境 2026-10-02）。
     * どの順で読まれても同じになるよう、各ファイルの1行目で順番を宣言する。
     *
     * ★V8 移行が済んで不要になったら、次の1行で全部消せる（この試験も消す）:
     *   grep -rl 'layer-order: V8 移行後に消す' apps/web/src | xargs sed -i '' '/layer-order: V8 移行後に消す/d'
     */
    // 層の順番を守る。注釈の有無は描画に関係しない。
    const order = /^@layer properties,\s*theme,\s*base,\s*components,\s*utilities;\s*(?:\/\*[\s\S]*?\*\/\s*)?@layer components\s*\{/
    const dir = new URL('.', import.meta.url)
    const modules = readdirSync(dir).filter((name) => name.endsWith('.module.css'))
    const offenders = modules.filter((name) => {
      const css = read(`./${name}`)
      return css.includes('@layer components') && !order.test(css)
    })
    expect(offenders).toEqual([])
  })

  it('代表的な画面側上書きも規定値に戻す', () => {
    const folderSelect = read('../chats/template-folder-select.tsx')
    const users = read('../users/users-filters.tsx')
    const tags = read('../friend-fields/tags-page-v4.tsx')
    const broadcasts = read('../../app/broadcasts/page.tsx')

    expect(folderSelect).toContain('size="field"')
    expect(users).not.toContain('className="h-9')
    expect(users).toContain('aria-label="UID連携で絞り込む"')
    expect(users).toContain('aria-label="所属アカウントで絞り込む"')
    expect(tags).not.toContain('v6-select-tight h-9')
    // ★V7 `Xn1Mz`：検索は共通 ListToolbar の1行目へそろえた（検索の高さ・幅は
    // 部品が持つ）。画面側の直書き検索 input（h-10 min-w-45 flex-1）に戻さない。
    // 選び口は共通 Select（素の select は置かない #640）。幅は部品の既定。
    expect(tags).toContain('<ListToolbar')
    expect(tags).not.toContain('type="search"')
    expect(tags).not.toContain('<select')
    expect(tags).toContain('aria-label="使用状態で絞り込む"')
    expect(tags).toContain('aria-label="表示件数"')
    expect(broadcasts).toContain('<ListToolbar')
    expect(broadcasts).not.toContain('type="search"')
  })
})
