// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import QrDialog from './qr-dialog'

const image = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,qr'))
const pdf = vi.hoisted(() => vi.fn(async () => new Blob(['pdf'])))
vi.mock('@/lib/qr-image', () => ({ qrToDataURL: image }))
vi.mock('@/lib/api', () => ({ api: { entryRoutes: { qrPdf: pdf } } }))
vi.mock('@/components/shared/entity-select', () => import('@/test-utils/entity-select-mock'))
const stopped = { id: 'stopped', refCode: 'old', name: '停止した経路', genre: null, isActive: false }
const active = { id: 'active', refCode: 'new', name: '有効な経路', genre: 'SNS', isActive: true }
const otherStopped = { ...stopped, id: 'other-stopped', refCode: 'other-old', name: '別の停止経路' }
beforeEach(() => { image.mockClear(); pdf.mockClear(); document.documentElement.dataset.theme = 'v8' })
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-theme') })

it('停止中でも同じ窓で有効経路を選び直し、そのURLのQRとPDFだけを使う', async () => {
  render(<QrDialog route={stopped} routes={[active, stopped, otherStopped]} onClose={() => {}} />)
  const selector = screen.getByRole('combobox', { name: '流入経路' })
  expect((selector as HTMLSelectElement).value).toBe('old')
  expect(screen.getByRole('alert').textContent).toContain('停止しています')
  expect(screen.queryByRole('option', { name: '別の停止経路' })).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByRole('button', { name: 'PDFで印刷' })).toBeNull()
  expect(image).not.toHaveBeenCalled()
  fireEvent.change(selector, { target: { value: 'new' } })
  await waitFor(() => expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('有効な経路 の QR コード'))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toMatch(/\/r\/new$/)
  expect(screen.queryByRole('alert')).toBeNull()
  await waitFor(() => expect(image).toHaveBeenCalledWith(expect.stringMatching(/\/r\/new$/), expect.any(Object)))
  const makeUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf')
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  fireEvent.click(screen.getByRole('button', { name: 'PDFで印刷' }))
  await waitFor(() => expect(pdf).toHaveBeenCalledWith('active'))
  expect(pdf).not.toHaveBeenCalledWith('stopped')
  makeUrl.mockRestore(); revokeUrl.mockRestore(); click.mockRestore()
})

it('一覧を持たない固定QRは選ぶ欄を増やさず元の経路を表示する', async () => {
  render(<QrDialog route={active} onClose={() => {}} />)
  expect(screen.queryByRole('combobox', { name: '流入経路' })).toBeNull()
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toMatch(/\/r\/new$/)
})
