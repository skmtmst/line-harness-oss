// @vitest-environment happy-dom
/*
 * バナー生成の上限・停止の帯（Pencil 35-4 `oaFjL`）。月の上限と課金の停止のときだけ課金プラン（/hq/billing）へ誘う。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BannerUsage } from '@/lib/hq-banners'

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))

import LimitState from './limit-state'

const usage = (over: Partial<BannerUsage>): BannerUsage => ({
  month: { used: 10, limit: 150, remaining: 140 }, today: { used: 1, limit: 30, remaining: 29 },
  paused: false, pausedReason: null, blocked: false, ...over,
})

afterEach(cleanup)

describe('上限・停止の帯', () => {
  it.each([
    ['課金の停止', usage({ blocked: true })],
    ['月の上限', usage({ month: { used: 150, limit: 150, remaining: 0 } })],
  ])('%sのときは「課金プランを見る」で請求の画面へ誘う', (_label, value) => {
    render(<LimitState usage={value} />)
    expect(screen.getByRole('link', { name: '課金プランを見る' }).getAttribute('href')).toBe('/hq/billing')
  })

  it.each([
    ['1日の上限', usage({ today: { used: 30, limit: 30, remaining: 0 } })],
    ['一時停止', usage({ paused: true })],
  ])('%sは待てば戻るので、課金プランへは誘わない', (_label, value) => {
    render(<LimitState usage={value} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '課金プランを見る' })).toBeNull()
  })

  it('空きがあるときは帯を出さない', () => {
    const view = render(<LimitState usage={usage({})} />)
    expect(view.container.textContent).toBe('')
  })
})
