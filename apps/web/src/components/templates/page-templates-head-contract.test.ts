import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'page-templates.module.css'), 'utf8')

/*
 * 型の見出しの既定は379板の絵どおり。
 * 題 22px/700/行32・間 4px・説明 13px/行19・上の余白 20。
 * 小さい「部品どおり」（EnlYo）は compact の変わり形に残す。
 * regular と未指定は既定（22/32）と同じにする。
 * v7 には効かない（すべて data-theme v8 限定）。
 */
describe('型の見出し（379板の絵）', () => {
  it('寸法は先頭の変数に1か所まとめ・値は絵どおり', () => {
    const vars = css.match(/:global\(\[data-theme='v8'\]\) \{[^}]*--tpl-head-pad-top[^}]*\}/s)
    expect(vars, '変数の一覧がありません').toBeTruthy()
    for (const [name, value] of [
      ['--tpl-head-pad-top', '20px'], ['--tpl-head-pad-side', '24px'], ['--tpl-head-pad-bottom', '12px'],
      ['--tpl-title-size', '22px'], ['--tpl-title-weight', '700'], ['--tpl-title-lh', '32px'],
      ['--tpl-head-gap', '4px'], ['--tpl-desc-size', '13px'], ['--tpl-desc-lh', '19px'],
      ['--tpl-toolbar-pad-block', '14px'], ['--tpl-toolbar-pad-side', '24px'], ['--tpl-toolbar-gap', '8px'],
      ['--tpl-folder-width', '200px'],
      ['--tpl-page-pad-block', '10px'], ['--tpl-page-pad-side', '24px'],
    ] as const) {
      expect(vars![0]).toMatch(new RegExp(`${name}:\\s*${value}`))
    }
  })

  it('既定は変数だけを使う（題・間・説明・上余白）', () => {
    expect(css).toMatch(/\.title \{[^}]*font-size:\s*var\(--tpl-title-size\)/s)
    expect(css).toMatch(/\.title \{[^}]*font-weight:\s*var\(--tpl-title-weight\)/s)
    expect(css).toMatch(/\.title \{[^}]*line-height:\s*var\(--tpl-title-lh\)/s)
    expect(css).toMatch(/\.headingText \{[^}]*gap:\s*var\(--tpl-head-gap\)/s)
    expect(css).toMatch(/\.description \{[^}]*font-size:\s*var\(--tpl-desc-size\)/s)
    expect(css).toMatch(/\.description \{[^}]*line-height:\s*var\(--tpl-desc-lh\)/s)
    expect(css).toMatch(/\.heading \{[^}]*padding:\s*var\(--tpl-head-pad-top\) var\(--tpl-head-pad-side\)/s)
    expect(css).toMatch(/\[data-page-template='list'\] > \.heading \{[^}]*padding-bottom:\s*var\(--tpl-head-pad-bottom\)/s)
  })

  it('compact は部品どおり（題20/27・間2・説明13/20）', () => {
    expect(css).toMatch(/heading-size='compact'.*?\.title \{[^}]*font-size:\s*var\(--tpl-compact-title-size\)/s)
    expect(css).toMatch(/heading-size='compact'.*?\.title \{[^}]*line-height:\s*var\(--tpl-compact-title-lh\)/s)
    expect(css).toMatch(/heading-size='compact'.*?\.headingText \{[^}]*gap:\s*var\(--tpl-compact-gap\)/s)
    expect(css).toMatch(/heading-size='compact'.*?\.description \{[^}]*line-height:\s*var\(--tpl-compact-desc-lh\)/s)
  })

  it('regular は既定と同じ（小さい題20pxの指定を持たない）', () => {
    expect(css).not.toMatch(/heading-size='regular'\] \.title \{[^}]*font-size:\s*20px/s)
    expect(css).not.toMatch(/heading-size='regular'\] \.headingText \{[^}]*gap:\s*2px/s)
  })

  it('一覧の頭は下余白12・帯は頭の直下（頭の高さ87）', () => {
    expect(css).toMatch(/\[data-page-template='list'\] > \.heading \{[^}]*padding-bottom:\s*var\(--tpl-head-pad-bottom\)/s)
    expect(css).toMatch(/\[data-page-template='list'\] \.stats \{[^}]*border-top:\s*0/s)
    const stats = css.match(/\[data-page-template='list'\] \.stats \{[^}]*\}/)
    expect(stats, '一覧の帯の枠がありません').toBeTruthy()
    expect(stats![0]).not.toMatch(/margin|padding-top/)
  })

  it('large の説明に絵に無い 12/18 を使わない', () => {
    const large = css.match(/heading-size='large'\] \.description \{[^}]*\}/)
    expect(large, 'large の説明がありません').toBeTruthy()
    expect(large![0]).toMatch(/font-size:\s*var\(--tpl-desc-size\)/)
    expect(large![0]).toMatch(/line-height:\s*var\(--tpl-desc-lh\)/)
  })
})
