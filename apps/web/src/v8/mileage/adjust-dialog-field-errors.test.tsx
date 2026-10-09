// @vitest-environment happy-dom
/*
 * B-139：マイルを手で動かす窓（M8zhjL）。確定で足りない欄は、その欄が赤くなり
 * 真下に理由が出て、1つ目の欄へ移る。窓の下の1行の帯だけで終わらせない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adjust = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      mileage: {
        ...actual.api.mileage,
        adjust,
        adjustmentPolicy: async () => ({ success: true, data: { configured: true, approvalThreshold: 100000 } }),
      },
    },
  }
})

import MileageAdjustDialog from './adjust-dialog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'v8')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  adjust.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
})

describe('マイルを手で動かす：確定で欄に知らせる（B-139）', () => {
  it('理由が空・マイル数が0なら口を呼ばず、2つの欄が赤くなり、マイル数の欄へ移る。開き直すと赤は消える', async () => {
    const render = (open: boolean) => root.render(
      <MileageAdjustDialog open={open} accountId="a" friendId="f" friendName="山田" friendRank={null} currentBalance={500} onCancel={() => {}} onCompleted={async () => {}} canConfigurePolicy={false} />,
    )
    await act(async () => { render(true) })
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve() })
    const amount = screen.getByLabelText('マイル数') as HTMLInputElement
    fireEvent.change(amount, { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'マイルを変更する' })) })
    for (let i = 0; i < 2; i += 1) await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
    expect(adjust).not.toHaveBeenCalled()
    expect(amount.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('adj-amount-error')?.textContent).toBe('1以上の整数でマイル数を入力してください')
    expect(screen.getByLabelText('詳しい理由').getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('adj-reason-error')?.textContent).toBe('詳しい理由を入力してください')
    expect(document.activeElement).toBe(amount)
    await act(async () => { render(false) })
    await act(async () => { render(true) })
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve() })
    expect(document.getElementById('adj-reason-error')).toBeNull()
  })
})
