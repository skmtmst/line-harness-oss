import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'top-bar.tsx'), 'utf8')
const css = readFileSync(join(here, 'top-bar.module.css'), 'utf8')
const appTopBar = readFileSync(join(here, '..', 'shell', 'app-top-bar.tsx'), 'utf8')

describe('V6共通トップバー', () => {
  it('Pencilの実ノードと7つの表示要素を固定する', () => {
    expect(source).toContain('data-design-node="cBSCb"')
    for (const label of ['title', 'マニュアル', 'LINEアカウント', 'roleLabel', 'userName', 'ログアウト']) {
      expect(source).toContain(label)
    }
    expect(source).toContain('accounts.map')
    // マニュアルとログアウトは白い枠つきのボタン。文字リンクにしない。
    expect(css).toContain('border: 1px solid var(--color-hairline);')
  })

  it('高さ・地色・下線をV6の値に固定する', () => {
    expect(css).toContain('height: 56px;')
    expect(css).toContain('background: var(--color-shell-gray);')
    expect(css).toContain('border-bottom: 1px solid var(--color-hairline);')
    // 画面名は $size-title(20)。素の 20px ではなくトークンで書く。
    expect(css).toContain('font-size: var(--text-title);')
    expect(css).toContain('font-weight: 600;')
  })

  it('押せる要素のキーボードフォーカスを消さない', () => {
    expect(css).toContain(':focus-visible')
    expect(css).not.toMatch(/outline:\s*(?:0|none)/)
  })

  it('統括配下だけLINEアカウント切替と隣の区切りを描かない', () => {
    expect(source).toContain('showAccountSwitcher = true')
    expect(source).toContain('showAccountSwitcher ? <>')
    expect(appTopBar).toContain("pathname === '/hq' || pathname.startsWith('/hq/')")
    expect(appTopBar).toContain('showAccountSwitcher={!isHq}')
  })

  it('V8 の 1152 の帯：札は潰さない・パンくずと自分の名前が縮む', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.accountPill \{[^}]*flex-shrink:\s*0/s)
    expect(css).toMatch(/\[data-theme=(["'])v8\1\] \.accountName \{\s*max-width:\s*128px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.crumbCurrent/s)
    expect(css).toMatch(/min-width:\s*0/)
    // v7 の札（縮む側）は変えない。
    expect(css).not.toMatch(/^\.accountPill \{[^}]*flex-shrink/m)
  })
})
