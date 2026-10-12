// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QrDialog from '@/v8/inflow-links/qr-dialog'
import DashboardQrDialog from '@/components/dashboard/qr-dialog'

const qr = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,x'))
vi.mock('@/lib/qr-image', () => ({ qrToDataURL: qr }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('現役の流入QRと停止経路の発行制限', () => {
  it('有効な経路はQR・コピー・ダウンロードを出す', () => {
    render(<QrDialog route={{ refCode: 'shop-a', name: '店頭POP', genre: null, isActive: true }} onClose={() => {}} />)
    expect(screen.getByRole('img', { name: '店頭POP の QR コード' }).getAttribute('src')).toContain('/api/qr')
    expect(screen.getByRole('button', { name: 'コピー' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '画像をダウンロード' }).getAttribute('href')).toContain('download=1')
  })
  it('停止中の経路はダッシュボードからQRを新しく発行できず、コピー・保存を止める', () => {
    const { container } = render(<DashboardQrDialog open accountName="店頭" baseLink="https://line.me/R/ti/p/@shop"
      initialRouteId="stopped" routes={[{ id: 'stopped', refCode: 'shop-old', name: '旧チラシ', isActive: false } as never]} onClose={() => {}} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a[href*="/api/qr"]')).toBeNull()
    const copy = screen.getByRole('button', { name: 'コピー' })
    expect(copy).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '画像をダウンロード' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'PDFで印刷' })).toHaveProperty('disabled', true)
    fireEvent.click(copy)
    expect(qr).not.toHaveBeenCalled()
    expect(screen.getAllByText(/この経路は停止しています/).length).toBeGreaterThan(0)
  })
  it('未登録 ref（有効・無効の概念なし）は従来どおり出す', () => {
    render(<QrDialog route={{ refCode: 'external-x', name: '(未登録)', genre: null, isActive: null }} onClose={() => {}} />)
    expect(screen.getByRole('img', { name: '(未登録) の QR コード' }).getAttribute('src')).toContain('/api/qr')
    expect(screen.getByRole('link', { name: '画像をダウンロード' })).toBeTruthy()
  })
})
