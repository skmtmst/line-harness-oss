// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Window } from 'happy-dom'
import postcss from 'postcss'
import { expect, it } from 'vitest'
import TargetMissing from './target-missing'

it('板の直下では左右に余白を持ち、入れ子では余白を重ねない', async () => {
  const window = new Window()
  try {
    const loadedStyle = document.querySelector<HTMLStyleElement>('style[data-vite-dev-id$="/target-missing.module.css"]')
    expect(loadedStyle).not.toBeNull()
    const css = postcss.parse(loadedStyle!.textContent ?? '')
    // このDOM環境が扱わないlayerだけを展開し、Viteが変換したCSSを適用する。
    css.walkAtRules('layer', rule => { if (rule.nodes) rule.replaceWith(...rule.nodes); else rule.remove() })
    const sheet = window.document.createElement('style')
    sheet.textContent = css.toString()
    window.document.head.append(sheet)
    const markup = renderToStaticMarkup(<TargetMissing kind="not-found" title="対象がありません" description="一覧から選んでください。" />)
    window.document.body.innerHTML = `<main data-page-template="detail" style="--space-24:24px">${markup}<div>${markup}</div></main>`
    const frame = window.document.querySelector<HTMLElement>('main')!
    const direct = frame.firstElementChild!
    const nested = frame.lastElementChild!.firstElementChild!
    expect(window.getComputedStyle(direct).marginInline).toBe('24px')
    expect(window.getComputedStyle(nested).marginInline).toBe('')
    frame.style.setProperty('--space-24', '32px')
    expect(window.getComputedStyle(direct).marginInline).toBe('32px')
  } finally {
    await window.happyDOM.close()
  }
})
