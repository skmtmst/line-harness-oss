// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeDashboard from './home'

const fixture = vi.hoisted(() => ({ accountId: 'account-1', search: '', get: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(fixture.search) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId, accounts: [{ id: fixture.accountId }], loading: false, error: null }) }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { get: fixture.get } }))
vi.mock('@/v8/dashboard/dashboard', () => ({ default: ({ usageStyle }: { usageStyle: string }) => <section aria-label="QRを開けるホーム" data-usage-style={usageStyle} /> }))
vi.mock('next/dynamic', () => ({ default: () => ({ style }: { style: string }) => <section aria-label={`${style}のホーム`} /> }))

beforeEach(() => { window.localStorage.clear(); fixture.accountId = 'account-1'; fixture.search = ''; vi.clearAllMocks() })
afterEach(cleanup)

describe('ホームから初期案内のQRを開く', () => {
  it.each(['standard', 'ec', 'restaurant', 'salon', 'consult', 'lesson'].flatMap(style => ['setup=0', 'setup=summary', 'qr=base'].map(query => [style, query])))('%sで%sを開いても選択中のホームを保つ', async (style, query) => {
    fixture.get.mockResolvedValue({ success: true, data: { style } })
    fixture.search = query
    const view = render(<HomeDashboard />)
    if (style === 'standard' || style === 'ec') {
      await waitFor(() => expect(screen.getByRole('region', { name: 'QRを開けるホーム' }).getAttribute('data-usage-style')).toBe(style))
    } else {
      expect(await screen.findByRole('region', { name: `${style}のホーム` })).toBeTruthy()
      expect(screen.queryByRole('region', { name: 'QRを開けるホーム' })).toBeNull()
    }
    fixture.search = ''; view.rerender(<HomeDashboard />)
    expect(screen.getByRole('region')).toBeTruthy()
  })

  it.each(['standard', 'ec', 'restaurant', 'salon', 'consult', 'lesson'])('QR指定がなければ%sのホームを出す', async (style) => {
    fixture.get.mockResolvedValue({ success: true, data: { style } })
    render(<HomeDashboard />)
    if (style === 'standard' || style === 'ec') {
      expect(await screen.findByRole('region', { name: 'QRを開けるホーム' })).toBeTruthy()
      await waitFor(() => expect(screen.getByRole('region', { name: 'QRを開けるホーム' }).getAttribute('data-usage-style')).toBe(style))
    } else expect(await screen.findByRole('region', { name: `${style}のホーム` })).toBeTruthy()
  })

  it.each(['', 'setup=0', 'qr=base'])('指定%sで別アカウントを未取得の間は前の盤も標準の盤も出さず、失敗は読み直せる', async query => {
    fixture.search = query
    fixture.get.mockResolvedValueOnce({ success: true, data: { style: 'restaurant' } }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true, data: { style: 'consult' } })
    const view = render(<HomeDashboard />)
    await screen.findByRole('region', { name: 'restaurantのホーム' })
    fixture.accountId = 'account-2'; view.rerender(<HomeDashboard />)
    expect(screen.getByLabelText('読み込んでいます')).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
    await screen.findByText('使い方のスタイルを読み込めませんでした')
    fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }))
    expect(await screen.findByRole('region', { name: 'consultのホーム' })).toBeTruthy()
  })

  it('端末に前の業種が残っても、所属を確かめたAPIの業種から開く', async () => {
    window.localStorage.setItem('lh_usage_style:account-1', 'restaurant')
    fixture.get.mockResolvedValue({ success: true, data: { style: 'lesson' } })
    render(<HomeDashboard />)
    expect(screen.queryByRole('region', { name: 'restaurantのホーム' })).toBeNull()
    expect(await screen.findByRole('region', { name: 'lessonのホーム' })).toBeTruthy()
  })
})
