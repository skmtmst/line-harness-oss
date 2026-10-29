// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Window } from 'happy-dom'
import postcss from 'postcss'
import { expect, test } from 'vitest'
import KpiBand from './kpi-band'
import KpiCard from './kpi-card'
import './kpi-band-v8.css'

const name = '会員向けのおすすめ商品と今月のお知らせを見る'
const detail = '通常メニュー（会員向け）・4,210 回'

test('実際のCSSで主の名前と補足を1行省略にし、名前の太さを500に保つ', async () => {
  const window = new Window()
  try {
    const stylesheets = ['kpi-band-v8.css', 'kpi-card.module.css'].map(file => {
      const style = document.querySelector(`style[data-vite-dev-id$="/${file}"]`)
      expect(style?.textContent).toBeTruthy()
      return style!.textContent!
    })
    const css = postcss.parse(stylesheets.join('\n'))
    // DOM環境が扱わないlayerだけ展開し、製品と同じCSSと変数を適用する。
    css.walkAtRules('layer', rule => { if (rule.nodes) rule.replaceWith(...rule.nodes); else rule.remove() })
    const sheet = window.document.createElement('style')
    sheet.textContent = css.toString()
    window.document.head.append(sheet)
    window.document.documentElement.style.setProperty('--tpl-band-number-weight', '500')
    window.document.body.innerHTML = renderToStaticMarkup(
      <KpiBand><KpiCard presentation="band" title="いちばん押された" primaryText={name}
        value={4210} unit="回" detail={detail} detailLayout="single" /></KpiBand>,
    )
    const primary = window.document.querySelector('[data-kpi-text-value]')!
    const primaryStyle = window.getComputedStyle(primary)
    expect(primaryStyle.whiteSpace).toBe('nowrap')
    expect(primaryStyle.textOverflow).toBe('ellipsis')
    expect(primaryStyle.overflow).toBe('hidden')
    expect(primaryStyle.fontWeight).toBe('500')
    expect(primary.getAttribute('title')).toBe(name)
    const supplement = window.document.querySelector('[data-kpi-detail] > span')!
    const supplementStyle = window.getComputedStyle(supplement)
    expect(supplementStyle.whiteSpace).toBe('nowrap')
    expect(supplementStyle.textOverflow).toBe('ellipsis')
    expect(supplement.getAttribute('title')).toBe(detail)
  } finally {
    await window.happyDOM.close()
  }
})
