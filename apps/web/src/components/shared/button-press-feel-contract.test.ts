import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const buttonCss = readFileSync(join(here, 'button.module.css'), 'utf8')
const iconCss = readFileSync(join(here, 'icon-button.module.css'), 'utf8')

/**
 * ★A の押した感じ（M10）。押している間は 0.97 に縮め色を濃く
 * （80ms ease-out）、離すとばねで戻る（160ms spring）。
 * v7 の沈み（0.98・80ms）は変えない。
 */
describe('★A 押した感じ（V8 のボタン・絵ボタン）', () => {
  for (const [name, css] of [
    ['button', buttonCss],
    ['icon-button', iconCss],
  ] as const) {
    it(`${name}：押している間は 0.97・濃く・80ms`, () => {
      expect(css).toMatch(/\[data-theme='v8'\] \.button:active:not\(:disabled\) \{\s*filter: brightness\(0\.95\);/s)
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-theme='v8'\] \.button:active:not\(:disabled\) \{\s*scale: 0\.97;/s,
      )
      expect(css).toMatch(/scale var\(--motion-instant\) var\(--motion-ease-out\)/)
    })

    it(`${name}：離すとばねで戻る（160ms spring）`, () => {
      expect(css).toMatch(/scale var\(--motion-snap\) var\(--motion-spring\)/)
    })

    it(`${name}：v7 の沈みは変えない`, () => {
      expect(css).toMatch(/\.button:active:not\(:disabled\) \{\s*scale: 0\.9[68];/s)
    })
  }
})
