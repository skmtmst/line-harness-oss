import { readdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const HERE = dirname(fileURLToPath(import.meta.url))

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
    // 「Inter, Noto Sans JP」の順（2026-10-25 オーナー決定）。英字と数字は
    // Inter（next/font が --font-inter を出す）、かなと漢字は Noto Sans JP。
    expect(globals).toMatch(/--font-sans:\s*var\(--font-inter\),\s*Inter,\s*var\(--font-noto-sans-jp\),\s*"Noto Sans JP",\s*sans-serif;/)
    expect(globals).not.toMatch(/--font-sans:\s*var\(--font-noto-sans-jp\)/)
    expect(layout).toContain('font-sans')
    expect(layout).not.toContain('fontFamily')
    // 文字のなめらか処理は既定のまま。body にも共通部品にも antialiased を付けない（2026-10-25）。
    expect(layout).not.toMatch(/className="[^"]*\bantialiased\b/)
    const sharedCss = readdirSync(HERE).filter((name) => name.endsWith('.css')).map((name) => read(`./${name}`)).join('\n')
    expect(sharedCss).not.toMatch(/-webkit-font-smoothing:\s*antialiased/)
    expect(sharedCss).not.toMatch(/font-family:\s*var\(--font-noto-sans-jp\)/)
    expect(layout).toContain("from 'next/font/google'")
  })

  it('U077/U084: 危険操作は共通Buttonの danger 役割で $danger + 白文字', () => {
    expect(buttonTsx).toContain("'danger'")
    expect(button).toMatch(/\.danger\s*{[^}]*background:\s*var\(--color-danger-action\)/s)
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
