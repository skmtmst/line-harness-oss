import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 動きの点検（2026-10-07）4 番：選んでいないフォルダの行で「…」を出すと、
 * 件数の上に斜めにずれて重なっていた（tailwind の relative が部品の
 * position: absolute に勝ち、場所取りの hack で位置がずれていた）。
 * 「…」は件数の場所に重ね、その間だけ件数を隠す。
 */
const dir = join(process.cwd(), 'src/components/shared')
const css = readFileSync(join(dir, 'folder-panel.module.css'), 'utf8')
const tsx = readFileSync(join(dir, 'folder-panel.tsx'), 'utf8')

describe('フォルダの「…」と件数', () => {
  it('V8 では「…」の箱に tailwind の relative を当てない（部品の absolute が負ける）', () => {
    expect(tsx).toMatch(/className=\{`\$\{styles\.menu\} v7:relative shrink-0`\}/)
    expect(tsx).not.toMatch(/\$\{styles\.menu\} relative /)
  })

  it('操作のある行は、乗せた・キーボードで入った・開いている間だけ件数を隠す', () => {
    expect(tsx).toMatch(/data-has-actions=\{hasActions \|\| undefined\}/)
    expect(css).toMatch(/\.row\[data-has-actions\]:not\(\[data-active\]\):is\(:hover, :focus-within, \[data-menu-open\]\) \.count \{ visibility: hidden; \}/)
  })

  it('選んでいない行の「…」は件数の場所（右端・上下の真ん中）に重ね、場所を取らない', () => {
    expect(css).toMatch(/\.row:not\(\[data-active\]\) \.menu \{\s*position: absolute; right: 10px; top: 50%; translate: 0 -50%;/)
    expect(css).not.toMatch(/margin-inline-start: -8px/)
  })
})
