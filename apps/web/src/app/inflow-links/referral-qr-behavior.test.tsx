// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ me: vi.fn(), qrPdf: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { staff: { me: mocks.me }, entryRoutes: { qrPdf: mocks.qrPdf } } }))
import ReferralQrModal, { type ReferralQrRoute } from './referral-qr-modal'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
const route: ReferralQrRoute = { id: 'route-a', refCode: 'shop-a', name: '店頭POP', genre: null, isActive: true }
const copy = vi.fn()
const onClose = vi.fn()
const createObjectURL = vi.fn(() => 'blob:qr-print')
const revokeObjectURL = vi.fn()
let clickedDownloads: string[]

async function show(value = route) {
  await act(async () => { root.render(<ReferralQrModal route={value} onClose={onClose} />) })
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.trim() === label || element.getAttribute('aria-label') === label)
  expect(button, label).toBeTruthy()
  await act(async () => { fireEvent.click(button!) })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.me.mockResolvedValue({ success: true, data: { role: 'owner' } })
  mocks.qrPdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
  copy.mockResolvedValue(undefined)
  createObjectURL.mockReturnValue('blob:qr-print')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)
  clickedDownloads = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clickedDownloads.push(this.download) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

describe('流入QRのコピーと保存', () => {
  it('現在の経路URLをコピーし、失敗したら全文を選べる欄を出す', async () => {
    copy.mockRejectedValueOnce(new Error('denied'))
    await show()
    await click('URLをコピー')
    expect(copy).toHaveBeenCalledWith('http://localhost:8788/r/shop-a')
    const input = document.querySelector<HTMLInputElement>('input')!
    expect(input.readOnly).toBe(true)
    expect(input.value).toBe('http://localhost:8788/r/shop-a')
    expect(document.body.textContent).toContain('コピーできませんでした')
    await click('URLをコピー')
    expect(document.body.textContent).toContain('コピーしました')
    expect(document.querySelector('input')).toBeNull()
  })

  it('登録済みの経路IDで印刷PDFを取得し、保存後は一時URLを解放する', async () => {
    await show()
    await click('印刷用PDF')
    expect(mocks.qrPdf).toHaveBeenCalledExactlyOnceWith('route-a')
    expect(clickedDownloads).toEqual(['qr-shop-a.pdf'])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:qr-print')
    const png = document.querySelector<HTMLAnchorElement>('a[download$=".png"]')!
    expect(png.href).toContain('size=320x320')
    expect(png.href).toContain('download=1')
  })

  it('PDFの失敗を知らせ、同じ窓から再試行できる', async () => {
    mocks.qrPdf.mockRejectedValueOnce(new Error('offline'))
    await show()
    await click('印刷用PDF')
    expect(document.body.textContent).toContain('印刷用PDFを作れませんでした')
    await click('印刷用PDF')
    expect(mocks.qrPdf).toHaveBeenCalledTimes(2)
    expect(clickedDownloads).toEqual(['qr-shop-a.pdf'])
    expect(document.body.textContent).not.toContain('印刷用PDFを作れませんでした')
  })

  it('停止した経路・未登録の経路には印刷APIを呼ばない', async () => {
    await show({ ...route, isActive: false })
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('a[download]')).toBeNull()
    expect(mocks.me).not.toHaveBeenCalled()
    await show({ ...route, id: null, isActive: null })
    expect(document.querySelector('img')).not.toBeNull()
    expect(document.body.textContent).not.toContain('印刷用PDF')
    expect(mocks.qrPdf).not.toHaveBeenCalled()
  })

  it('閲覧だけの担当者にはPDF操作を出さず、PNGは保存できる', async () => {
    mocks.me.mockResolvedValue({ success: true, data: { role: 'viewer' } })
    await show()
    expect(document.body.textContent).not.toContain('印刷用PDF')
    expect(document.querySelector('a[download$=".png"]')).not.toBeNull()
    expect(mocks.qrPdf).not.toHaveBeenCalled()
  })

  it('流入と計測の操作権限がある担当者は印刷PDFを保存できる', async () => {
    mocks.me.mockResolvedValue({ success: true, data: { role: 'staff', permissionKeys: ['/inflow-links'] } })
    await show()
    await click('印刷用PDF')
    expect(mocks.qrPdf).toHaveBeenCalledExactlyOnceWith('route-a')
  })

  it('別の機能だけの操作権限では印刷PDFを出さない', async () => {
    mocks.me.mockResolvedValue({ success: true, data: { role: 'staff', permissionKeys: ['/friends'] } })
    await show()
    expect(document.body.textContent).not.toContain('印刷用PDF')
    expect(mocks.qrPdf).not.toHaveBeenCalled()
  })

  it('経路を切り替えたあとに前のPDFが届いても保存しない', async () => {
    let resolve!: (value: Blob) => void
    mocks.qrPdf.mockReturnValue(new Promise<Blob>((done) => { resolve = done }))
    await show()
    await click('印刷用PDF')
    expect(document.body.textContent).toContain('PDFを作っています')
    await show({ ...route, id: 'route-b', refCode: 'shop-b' })
    await act(async () => { resolve(new Blob(['%PDF'])) })
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(clickedDownloads).toEqual([])
  })

  it('QR画像の読み込み失敗を知らせ、再読み込みのURLを更新する', async () => {
    await show()
    await act(async () => { fireEvent.error(document.querySelector('img')!) })
    expect(document.body.textContent).toContain('QRコードを読み込めませんでした')
    await click('もう一度読み込む')
    expect(document.querySelector('img')?.src).toContain('&retry=1')
  })
})
