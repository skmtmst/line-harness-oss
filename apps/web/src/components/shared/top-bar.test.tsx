import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'top-bar.tsx'), 'utf8')
const css = readFileSync(join(here, 'top-bar.module.css'), 'utf8')

describe('V6共通トップバー', () => {
  it('Pencilの実ノードと7つの表示要素を固定する', () => {
    expect(source).toContain('data-design-node="cBSCb"')
    for (const label of ['title', 'マニュアル', 'LINEアカウント', 'roleLabel', 'userName', 'ログアウト']) {
      expect(source).toContain(label)
    }
    expect(source).toContain('accounts.map')
  })

  it('高さ・地色・下線をV6の値に固定する', () => {
    expect(css).toContain('height: 56px;')
    expect(css).toContain('background: var(--color-surface-chrome);')
    expect(css).toContain('border-bottom: 1px solid var(--color-hairline);')
    expect(css).toContain('font-size: 20px;')
    expect(css).toContain('font-weight: 700;')
  })

  it('押せる要素のキーボードフォーカスを消さない', () => {
    expect(css).toContain(':focus-visible')
    expect(css).not.toMatch(/outline:\s*(?:0|none)/)
  })
})
