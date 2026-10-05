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
  it('既定は題22/700/32・間4・説明13/19・上余白20', () => {
    expect(css).toMatch(/\.title \{[^}]*font-size:\s*22px/s)
    expect(css).toMatch(/\.title \{[^}]*font-weight:\s*700/s)
    expect(css).toMatch(/\.title \{[^}]*line-height:\s*32px/s)
    expect(css).toMatch(/\.headingText \{[^}]*gap:\s*4px/s)
    expect(css).toMatch(/\.description \{[^}]*font-size:\s*13px/s)
    expect(css).toMatch(/\.description \{[^}]*line-height:\s*19px/s)
    expect(css).toMatch(/\.heading \{[^}]*padding:\s*20px 24px/s)
  })

  it('compact は部品どおり（題20/27・間2・説明13/20）', () => {
    expect(css).toMatch(/heading-size='compact'.*?\.title \{[^}]*font-size:\s*20px/s)
    expect(css).toMatch(/heading-size='compact'.*?\.title \{[^}]*line-height:\s*27px/s)
    expect(css).toMatch(/heading-size='compact'.*?\.headingText \{[^}]*gap:\s*2px/s)
    expect(css).toMatch(/heading-size='compact'.*?\.description \{[^}]*line-height:\s*20px/s)
  })

  it('regular は既定と同じ（小さい題20pxの指定を持たない）', () => {
    expect(css).not.toMatch(/heading-size='regular'\] \.title \{[^}]*font-size:\s*20px/s)
    expect(css).not.toMatch(/heading-size='regular'\] \.headingText \{[^}]*gap:\s*2px/s)
  })

  it('large の説明に絵に無い 12/18 を使わない', () => {
    const large = css.match(/heading-size='large'\] \.description \{[^}]*\}/)
    expect(large, 'large の説明がありません').toBeTruthy()
    expect(large![0]).toMatch(/font-size:\s*13px/)
    expect(large![0]).toMatch(/line-height:\s*19px/)
  })
})
