import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import FormKpiValue from './form-kpi-value'

describe('回答フォームのKPI', () => {
  it('取得できて0件なら0件と表示する', () => {
    const html = renderToStaticMarkup(<FormKpiValue value={0} />)

    expect(html).toContain('>0<')
    expect(html).toContain('>件<')
  })

  it('未取得なら0件と作らずダッシュだけを表示する', () => {
    const html = renderToStaticMarkup(<FormKpiValue value={null} />)

    expect(html).toContain('>—<')
    expect(html).not.toContain('>0<')
    expect(html).not.toContain('>件<')
  })
})
