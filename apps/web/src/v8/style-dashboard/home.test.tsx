// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeDashboard from './home'

const fixture = vi.hoisted(() => ({ search: '', get: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(fixture.search) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
vi.mock('@/lib/api-styles', () => ({ styleApi: { get: fixture.get } }))
vi.mock('@/v8/dashboard/dashboard', () => ({ default: () => <section aria-label="QRを開けるホーム" /> }))
vi.mock('next/dynamic', () => ({ default: () => ({ style }: { style: string }) => <section aria-label={`${style}のホーム`} /> }))

beforeEach(() => { window.localStorage.clear(); fixture.search = ''; vi.clearAllMocks() })
afterEach(cleanup)

describe('ホームから初期案内のQRを開く', () => {
  it.each(['restaurant', 'salon', 'consult', 'lesson'])('%sを選んだ店でもQRの行き先を優先し、閉じた後は業種の画面へ戻る', async (style) => {
    window.localStorage.setItem('lh_usage_style:account-1', style)
    fixture.get.mockResolvedValue({ success: true, data: { style } })
    fixture.search = 'qr=base'
    const view = render(<HomeDashboard />)
    expect(screen.getByRole('region', { name: 'QRを開けるホーム' })).toBeTruthy()
    await waitFor(() => expect(fixture.get).toHaveBeenCalledWith('account-1'))
    expect(screen.getByRole('region', { name: 'QRを開けるホーム' })).toBeTruthy()
    fixture.search = ''
    view.rerender(<HomeDashboard />)
    expect(await screen.findByRole('region', { name: `${style}のホーム` })).toBeTruthy()
  })

  it.each(['restaurant', 'salon', 'consult', 'lesson'])('QR指定がなければ%sのホームを出す', async (style) => {
    fixture.get.mockResolvedValue({ success: true, data: { style } })
    render(<HomeDashboard />)
    expect(await screen.findByRole('region', { name: `${style}のホーム` })).toBeTruthy()
  })
})
