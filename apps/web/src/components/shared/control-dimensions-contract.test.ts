import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Pencil V6 の入力・選択・押し口規定', () => {
  it('役割ごとの高さと白背景を共通部品で維持する', () => {
    const button = read('./button.module.css')
    const formControls = read('./form-controls.module.css')
    const select = read('./select-field.module.css')
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
    expect(select).toMatch(/\.select\s*{[^}]*height:\s*40px/s)
    expect(select).toMatch(/background-color:\s*var\(--color-canvas\)/)
    expect(select).toMatch(/background-position:\s*right 13px center/)
    /*
     * 呼び出し側の幅指定（`w-full` など utilities レイヤー）が既定幅
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

  it('代表的な画面側上書きも規定値に戻す', () => {
    const folderSelect = read('../chats/template-folder-select.tsx')
    const users = read('../users/users-filters.tsx')
    const tags = read('../friend-fields/tags-page-v4.tsx')
    const broadcasts = read('../../app/broadcasts/page.tsx')

    expect(folderSelect).toContain('size="field"')
    expect(users).not.toContain('className="h-9')
    expect(users).toContain('v6-select h-10 min-w-44')
    expect(tags).not.toContain('v6-select-tight h-9')
    expect(tags).toContain('h-10 min-w-45 flex-1')
    expect(tags).toContain('h-10 min-w-44')
    expect(tags).toContain('h-10 min-w-38')
    expect(broadcasts).toContain('bg-canvas focus:ring-accent h-10')
  })
})
