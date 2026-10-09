// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { emptyLayout, type FormInputBlock } from '@line-crm/shared'
import Form from './Form'

vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }))
vi.mock('../lib/api.js', () => ({ api: { getForm: vi.fn(), getMyLatestFormAnswer: vi.fn(), submitForm: vi.fn(), uploadFormFile: vi.fn(), liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }) } }))
const { api } = await import('../lib/api.js')
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function open() {
  const layout = emptyLayout()
  layout.options.confirmDialog = { enabled: false }
  const fields: Partial<FormInputBlock>[] = [
    { type: 'text', name: 'name', label: 'お名前', placeholder: '例：山田 太郎' },
    { type: 'text', name: 'email', label: 'メール', limit: { format: 'email' }, placeholder: '例：sample@example.com' },
    { type: 'text', name: 'tel', label: '電話', limit: { format: 'tel' }, placeholder: '例：090-1234-5678' },
    { type: 'textarea', name: 'note', label: '自由に書く', placeholder: '例：ご希望を記入' },
    { type: 'date', name: 'date', label: '日付', placeholder: '例：2026/10/09' },
    { type: 'text', name: 'time', label: '時刻', limit: { format: 'time' }, placeholder: '例：13:00' },
    { type: 'address', name: 'address', label: '住所', placeholder: '例：1-2-3' },
    { type: 'file', name: 'file', label: '添付画像' },
    { type: 'rating', name: 'rating', label: '評価' },
  ]
  layout.sections[0].blocks = fields.map((f, i) => ({ kind: 'input', id: `b${i}`, ...f } as FormInputBlock))
  vi.mocked(api.getForm).mockResolvedValue({ id: 'f1', name: '入力の見本', description: '', layout, isActive: true })
  vi.mocked(api.submitForm).mockResolvedValue({ status: 200, body: { success: true, data: {} } })
  render(<MemoryRouter initialEntries={['/forms/f1']}><Routes><Route path="/forms/:id" element={<Form />} /></Routes></MemoryRouter>)
  await screen.findByLabelText('お名前')
}

describe('編集した参考の文字と実際の入力', () => {
  it('入力ごとの参考の文字を出すが、参考の文字を回答として送らない', async () => {
    await open()
    for (const hint of ['例：山田 太郎', '例：sample@example.com', '例：090-1234-5678', '例：ご希望を記入', '例：2026/10/09', '例：13:00', '例：1-2-3']) {
      expect((screen.getByPlaceholderText(hint) as HTMLInputElement).value).toBe('')
    }
    fireEvent.click(screen.getByRole('button', { name: '送信する' }))
    await screen.findByText(/^ご回答ありがとうございました/)
    const data = vi.mocked(api.submitForm).mock.calls[0][1].data
    expect(JSON.stringify(data)).not.toContain('例：')
  })

  it('日付と時刻は実際の入力の種類で、選んだ値を保存する', async () => {
    await open()
    const date = screen.getByLabelText('日付') as HTMLInputElement
    const time = screen.getByLabelText('時刻') as HTMLInputElement
    expect(date.type).toBe('date')
    expect(time.type).toBe('time')
    fireEvent.change(date, { target: { value: '2026-10-09' } })
    fireEvent.change(time, { target: { value: '13:30' } })
    fireEvent.click(screen.getByRole('button', { name: '送信する' }))
    await screen.findByText(/^ご回答ありがとうございました/)
    expect(vi.mocked(api.submitForm).mock.calls[0][1].data).toMatchObject({ date: '2026-10-09', time: '13:30' })
  })

  it('添付ボタンでファイルを選ぶと既存のアップロードへ送り、返った画像を表示する', async () => {
    await open()
    vi.mocked(api.uploadFormFile).mockResolvedValue({ success: true, data: { key: 'photo.png', url: 'https://example.test/photo.png', mimeType: 'image/png', size: 10 } })
    const file = new File(['test-image'], 'photo.png', { type: 'image/png' })
    const input = screen.getByLabelText('添付画像', { selector: 'input' }) as HTMLInputElement
    const choose = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: '写真・書類を選ぶ' }))
    expect(choose).toHaveBeenCalled()
    expect(input.accept).not.toContain('application/pdf')
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(api.uploadFormFile).toHaveBeenCalledWith('f1', file, undefined))
    expect((await screen.findByAltText('送った画像') as HTMLImageElement).src).toBe('https://example.test/photo.png')
  })
})
