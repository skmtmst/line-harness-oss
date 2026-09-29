// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import KpiCard from './kpi-card'

/**
 * D021: 値なし（undefined）で KpiCard が画面ごと落ちる。
 *
 * 呼び出し側が `x?.y` をそのまま渡すと undefined が来る。null と同じく
 * 「—」を出して落ちない。数でない値（NaN）も同じ。0 は 0 のまま出す。
 */
describe('KpiCardの値なし', () => {
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

  async function renderValue(value: number | null | undefined) {
    await act(async () => {
      root.render(<KpiCard title="付与" value={value} unit="マイル" detail="今月" />)
      await Promise.resolve()
    })
  }

  it('undefined でも落ちず「—」を出す', async () => {
    await renderValue(undefined)
    expect(host.textContent).toContain('—')
  })

  it('null は今までどおり「—」を出す', async () => {
    await renderValue(null)
    expect(host.textContent).toContain('—')
  })

  it('NaN は「—」を出す（生の NaN を出さない）', async () => {
    await renderValue(NaN)
    expect(host.textContent).toContain('—')
    expect(host.textContent).not.toContain('NaN')
  })

  it('0 は 0 のまま出す（「—」にしない）', async () => {
    await renderValue(0)
    expect(host.textContent).toContain('0')
    expect(host.textContent).not.toContain('—')
  })

  it('数は桁区切りで出す', async () => {
    await renderValue(12345)
    expect(host.textContent).toContain('12,345')
  })
})
