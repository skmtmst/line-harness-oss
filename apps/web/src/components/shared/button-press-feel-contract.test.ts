import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const buttonCss = readFileSync(join(here, 'button.module.css'), 'utf8')
const iconCss = readFileSync(join(here, 'icon-button.module.css'), 'utf8')
const globals = readFileSync(join(here, '../../app/globals.css'), 'utf8')
const sidebarCss = readFileSync(join(here, '../layout/sidebar.module.css'), 'utf8')

const brightnessOf = (token: string) => Number(globals.match(new RegExp(`${token}:\\s*brightness\\(([\\d.]+)\\)`))?.[1])

/**
 * 押した感じ（動きの点検 6 番・2026-10-07）。押している間は乗せたときより
 * 暗く、ごく少し縮む（0.98・120ms）。離すとばねで戻る（160ms spring）。
 * 以前は乗せる 0.92・押す 0.95 で、押すと明るく戻る逆の手応えだった。
 * v7 の沈み（0.98・80ms）は変えない。
 */
describe('押した感じ（V8 のボタン・絵ボタン）', () => {
  it('押す暗さは乗せる暗さ（0.92）より暗い', () => {
    expect(buttonCss).toMatch(/\.primary:hover:not\(:disabled\) \{\s*filter: brightness\(0\.92\);/)
    expect(brightnessOf('--press-dim')).toBeLessThan(0.92)
    expect(brightnessOf('--press-dim-soft')).toBeLessThan(1)
    expect(globals).toMatch(/--press-scale:\s*0\.98;/)
  })

  for (const [name, css, dim] of [
    ['button', buttonCss, '--press-dim'],
    ['icon-button', iconCss, '--press-dim-soft'],
  ] as const) {
    it(`${name}：押している間は暗く・0.98・120ms（数字は変数から）`, () => {
      expect(css).toMatch(new RegExp(`\\[data-theme='v8'\\] \\.button:active:not\\(:disabled\\) \\{\\s*filter: var\\(${dim}\\);`))
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-theme='v8'\] \.button:active:not\(:disabled\) \{\s*scale: var\(--press-scale\);/s,
      )
      expect(css).toMatch(/scale var\(--motion-fast\) var\(--motion-ease-out\)/)
    })

    it(`${name}：離すとばねで戻る（160ms spring）`, () => {
      expect(css).toMatch(/scale var\(--motion-snap\) var\(--motion-spring\)/)
    })

    it(`${name}：v7 の沈みは変えない`, () => {
      expect(css).toMatch(/\.button:active:not\(:disabled\) \{\s*scale: 0\.9[68];/s)
    })
  }

  it('白地のボタンは弱い暗さ（白が灰色に沈みすぎない）', () => {
    expect(buttonCss).toMatch(/\[data-theme='v8'\] \.secondary:active:not\(:disabled\) \{\s*filter: var\(--press-dim-soft\);/)
  })

  it('押せるものは全部「指」の形（Tailwind の土台は button を default にする）', () => {
    expect(globals).toMatch(/:is\(button, \[role='button'\], \[role='tab'\], \[role='menuitem'\], \[role='option'\], summary\):not\(:disabled, \[aria-disabled='true'\]\) \{\s*cursor: pointer;/)
  })

  it('左メニューの速さは共通の変数（150ms ease の直書きをやめた）', () => {
    expect(sidebarCss).not.toMatch(/150ms/)
    expect(sidebarCss).toMatch(/var\(--motion-fast\) var\(--motion-ease-out\)/)
  })
})
