// @vitest-environment happy-dom
/*
 * N-204 (#796): 一覧の容量案内を実物の React で描いて確かめる。
 * ソース文字列の検査では、stateごとの文言・行動案・棒の色の出分けを
 * 固定できない。ここは MediaQuotaGuidance を実マウントする。
 */
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MediaQuota } from '@/lib/api'
import { MediaQuotaGuidance } from './media-quota-guidance'

afterEach(() => cleanup())

const quotaOf = (state: MediaQuota['state'], usageRate: number): MediaQuota => ({
  usageBytes: 8_000_000_000,
  reservedBytes: 0,
  limitBytes: 10_000_000_000,
  remainingBytes: 2_000_000_000,
  usageRate,
  state,
})

describe('容量案内はstateで文言と行動案を変える（N-204・実マウント）', () => {
  test('80%未満は警告も行動案も出さない', () => {
    render(<MediaQuotaGuidance quota={quotaOf('normal', 0.79)} failed={false} onShowNearLimit={() => {}} />)
    expect(screen.queryByText(/80%以上/)).toBeNull()
    expect(screen.queryByText(/上限に達しました/)).toBeNull()
    expect(screen.queryByRole('button', { name: '上限に近いものを見る' })).toBeNull()
    expect(screen.getByRole('progressbar', { name: '保存容量' })).toBeTruthy()
  })

  test('80%以上は整理の案内と行動案を出す', () => {
    const onShow = vi.fn()
    render(<MediaQuotaGuidance quota={quotaOf('notice', 0.8)} failed={false} onShowNearLimit={onShow} />)
    expect(screen.getByText(/80%以上を使っています/)).toBeTruthy()
    const button = screen.getByRole('button', { name: '上限に近いものを見る' })
    fireEvent.click(button)
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  test('上限到達は保存不可の案内と行動案を出す', () => {
    render(<MediaQuotaGuidance quota={quotaOf('full', 1)} failed={false} onShowNearLimit={() => {}} />)
    expect(screen.getByText(/上限に達しました/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '上限に近いものを見る' })).toBeTruthy()
  })

  test('未取得は確認できない旨だけ出す', () => {
    render(<MediaQuotaGuidance quota={null} failed={true} onShowNearLimit={() => {}} />)
    expect(screen.getByText('保存容量を確認できませんでした。')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})
