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

  it('統括の画面にもLINEアカウント切替を出す（殻合わせ・絵 V8-B/JKjsE）', () => {
    // 殻合わせ前は統括で札を隠していた（showAccountSwitcher={!isHq}）。
    // 絵どおり統括もふだんの画面も同じ殻にするため、常に付ける。
    expect(source).toContain('showAccountSwitcher = true')
    expect(source).toContain('showAccountSwitcher ? <>')
    expect(appTopBar).toContain('showAccountSwitcher')
    expect(appTopBar).not.toContain('showAccountSwitcher={!isHq}')
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

/*
 * V8 殻合わせ（絵 `V8-B/JKjsE`）。統括もふだんの画面も同じ帯：
 * ホーム › 画面名・切替札（役割＋名前）・鈴・名前と役割・ログアウト。
 * v7 の土台クラスは触らない（V8 の上書きだけ）。
 */
describe('V8 の帯は絵どおり（殻合わせ）', () => {
  it('パンくずの手前はホーム（格子印＋リンク）', () => {
    expect(source).toContain('href="/"')
    expect(source).toContain('ホーム')
    expect(source).toContain('crumbHome')
    expect(source).toContain('HomeGridIcon')
  })

  it('切替の札に役割を添える（v8-only・v7 の1行札は不変）', () => {
    expect(source).toContain('pillText')
    expect(source).toContain('pillRole')
    expect(css).toMatch(/\[data-theme='v8'\] \.pillText \{[^}]*flex-direction:\s*column/s)
    const pillTextBase = css.match(/\.pillText \{[^}]*\}/s)?.[0] ?? ''
    expect(pillTextBase).toMatch(/display:\s*contents/)
  })

  it('自分は名前→役割の積み（v7 は素通しで並び不変）', () => {
    expect(source).toContain('identityText')
    expect(css).toMatch(/\[data-theme='v8'\] \.identityText \{[^}]*flex-direction:\s*column/s)
    const textBase = css.match(/\.identityText \{[^}]*\}/s)?.[0] ?? ''
    expect(textBase).toMatch(/display:\s*contents/)
  })

  it('パンくずは「ホーム › 画面名」1回だけ（先頭のホームは重ねない）', () => {
    expect(source).toContain("crumb.label !== 'ホーム'")
    expect(source).not.toContain('crumbs == null && current')
  })

  it('『前の見た目に戻す』は帯に無い（オーナー指示で廃止）', () => {
    expect(source).not.toContain('前の見た目に戻す')
    expect(source).not.toContain('onRevertTheme')
    expect(css).not.toContain('.revert')
    expect(appTopBar).not.toContain('onRevertTheme')
    expect(appTopBar).not.toContain("applyAdminTheme('v7')")
  })
})
