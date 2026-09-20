import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/*
 * #976 デザイン統一の契約。
 *
 * 外部UI監査と共通デザイン仕様（2026-09-20）で決まった統一ルールが
 * 部品側で守られているかを見張る。画面側の対応（必須札の貼り替え等）は
 * 各画面の契約試験が見る。
 */
describe('#976 デザイン統一', () => {
  const globals = read('../../app/globals.css')
  const button = read('./button.module.css')
  const buttonTsx = read('./button.tsx')
  const dialogTsx = read('./dialog.tsx')
  const dialogCss = read('./dialog.module.css')
  const formControlsTsx = read('./form-controls.tsx')
  const formControlsCss = read('./form-controls.module.css')
  const searchFieldTsx = read('./search-field.tsx')
  const layout = read('../../app/layout.tsx')

  it('U080: 書体の正本は --font-sans で、body は inline style ではなく font-sans を読む', () => {
    expect(globals).toMatch(/--font-sans:\s*"Noto Sans JP",\s*"Hiragino Sans",\s*"Yu Gothic",\s*system-ui,\s*sans-serif;/)
    expect(layout).toContain('font-sans')
    expect(layout).not.toContain('fontFamily')
    // 友だち属性V2の画像比較用例外（SF系）は残す。統一対象から外す決定。
    expect(globals).toMatch(/\.friend-attributes-v2-shell\s*{[^}]*font-family:\s*"SF Pro Text"/s)
  })

  it('U077/U084: 危険操作は共通Buttonの danger 役割で $danger + 白文字', () => {
    expect(buttonTsx).toContain("'danger'")
    expect(button).toMatch(/\.danger\s*{[^}]*background:\s*var\(--color-danger\)/s)
    expect(button).toMatch(/\.danger\s*{[^}]*color:\s*var\(--color-on-accent\)/s)
  })

  it('U083: Dialog の操作は自前ボタンを持たず共通Buttonを使う', () => {
    expect(dialogTsx).toContain("import Button from './button'")
    // 色・高さ・文字は Button 側の仕事。dialog 側に残るのは幅の指定だけ。
    expect(dialogCss).not.toMatch(/\.cancel\b|\.confirm\b/)
    expect(dialogCss).not.toMatch(/\.button\s*{/)
  })

  it('U086: 必須の印は共通の「必須」札 RequiredBadge に1本化する', () => {
    expect(formControlsTsx).toContain('export function RequiredBadge')
    expect(formControlsCss).toMatch(/\.required\s*{[^}]*var\(--color-danger\)/s)
  })

  it('U087: 検索欄は aria-label を必須にする（placeholder は名前の代わりにならない）', () => {
    expect(searchFieldTsx).toMatch(/'aria-label':\s*string/)
  })
})
