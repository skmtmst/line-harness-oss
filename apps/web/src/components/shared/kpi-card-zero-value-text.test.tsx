// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import KpiCard from './kpi-card'

/*
 * 14：一覧の上の数の帯でも、0 は薄い灰にする。value={0} だけでなく、
 * valueText で渡された 0（「0件」「¥0」など）にも data-kpi-zero を付ける。
 * 数でない文字（停止中など）には付けない。
 */
describe('KpiCardの0（文字で渡した値）', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  async function renderText(valueText: string) {
    await act(async () => {
      root.render(<KpiCard title="未対応" value={null} unit="" valueText={valueText} presentation="band" detail={null} icon={null} />)
      await Promise.resolve()
    })
    return host.firstElementChild as HTMLElement
  }

  it.each(['0', '0件', '0 件', '¥0', '0%'])('「%s」は0として印を付ける', async (valueText) => {
    const card = await renderText(valueText)
    expect(card.hasAttribute('data-kpi-zero')).toBe(true)
  })

  it.each(['停止中', '12月25日', '5件', '¥1,200'])('「%s」には0の印を付けない', async (valueText) => {
    const card = await renderText(valueText)
    expect(card.hasAttribute('data-kpi-zero')).toBe(false)
  })

  it('value={0} は今までどおり0の印を付ける', async () => {
    await act(async () => {
      root.render(<KpiCard title="未対応" value={0} unit="件" presentation="band" detail={null} icon={null} />)
      await Promise.resolve()
    })
    expect((host.firstElementChild as HTMLElement).hasAttribute('data-kpi-zero')).toBe(true)
  })
})
