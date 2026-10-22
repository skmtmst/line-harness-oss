import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * V8 の「?」の印：文字の「?」は上下の余白のくせで丸の真ん中に来なかった（2026-10-23 オーナー指摘）。
 * 図形のアイコン（lucide の CircleHelp）で描き、大きさは 16px のまま。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'help-tip.module.css'), 'utf8')
const tsx = readFileSync(join(HERE, 'help-tip.tsx'), 'utf8')

describe('「?」の印', () => {
  it('文字ではなく図形のアイコンで描く', () => {
    expect(tsx).toMatch(/<CircleHelp className=\{styles\.markIcon\}/)
    expect(tsx).not.toMatch(/>\?<\/span>/)
  })

  it('印は 16px の正方形', () => {
    expect(css).toMatch(/:root \.markIcon \{[^}]*width: 16px;[^}]*height: 16px;/)
  })
})
