import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const globals = readFileSync(join(HERE, '../../app/globals.css'), 'utf8')

describe('押せるカードだけ浮く（2026-10-25）', () => {
  it('乗せると 2px 浮き、影はくっきり版の深い方（ぼかし最大 8px）。動きを減らす設定では浮かない', () => {
    expect(globals).toContain('--card-hover-lift: translateY(-2px);')
    expect(globals).toContain('--motion-card-lift: 150ms;')
    expect(globals).toContain('--card-shadow-hover: 0 0 0 1px rgba(0, 0, 0, 0.07), 0 1px 1px rgba(0, 0, 0, 0.05), 0 3px 4px -1px rgba(0, 0, 0, 0.08), 0 8px 10px -5px rgba(0, 0, 0, 0.09);')
    expect(globals).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*:root \[data-pressable-card\]:hover \{ transform: var\(--card-hover-lift\); \}/)
    // 浮く動きは押せるカードの印にだけ付く。カード全体（Card・--card-shadow）には付けない。
    expect(globals).not.toMatch(/(?:card-shadow|\.card)[^{]*:hover\s*\{[^}]*card-hover-lift/)
  })
  it('友だち詳細の「次の配信」の行（カード全体がリンク）は押せるカード。押せない同じ形の行には付けない', () => {
    const tsx = readFileSync(join(HERE, '../../v8/friend-detail/overview-tab.tsx'), 'utf8')
    expect(tsx).toMatch(/<Link[^>]*className=\{styles\.row\}\s*data-pressable-card=""/s)
    expect(tsx).not.toMatch(/<div className=\{`\$\{styles\.row\} \$\{styles\.rowMuted\}`\}[^>]*data-pressable-card/)
  })
})
