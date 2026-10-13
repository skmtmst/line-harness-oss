// @vitest-environment happy-dom
import type { PropsWithChildren } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import FormFileAttachments from './form-file-attachments'
import { fetchApiBlob } from '@/lib/api'
vi.mock('@/lib/api', () => ({ fetchApiBlob: vi.fn(async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' })) }))
vi.mock('./dialog', () => ({ default: ({ open, children, title }: PropsWithChildren<{ open: boolean; title: string }>) => open ? <div role="dialog" aria-label={title}>{children}</div> : null }))
beforeEach(() => { vi.spyOn(URL, 'createObjectURL').mockReturnValue('about:blank'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })
describe('回答の書類', () => {
  it('閲覧不可・期限で消した書類はファイルを取得しない', () => {
    render(<FormFileAttachments value={[{ fileId: 'secret', state: 'restricted', kind: 'identity' }, { fileId: 'expired', state: 'expired' }]} />)
    expect(screen.getByText('見る権限がありません')).toBeTruthy()
    expect(screen.getByText('期限で消しました')).toBeTruthy()
    expect(fetchApiBlob).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('PDFは認証付きで取得し、名前を押して大きく開く', async () => {
    render(<FormFileAttachments value={[{ fileId: 'file', filename: '申込.pdf', mimeType: 'application/pdf', state: 'ready' }]} />)
    expect(fetchApiBlob).toHaveBeenCalledWith('/api/form-files/file/content')
    fireEvent.click(screen.getByRole('button', { name: '申込.pdfを開く' }))
    expect(await screen.findByRole('dialog', { name: '申込.pdf' })).toBeTruthy()
    expect(await screen.findByTitle('申込.pdf')).toBeTruthy()
  })
})

it('検査中と危ない書類を分け、どちらも取得させない', () => {
  render(<FormFileAttachments value={[{ fileId: 'pending', state: 'pending' }, { fileId: 'unsafe', state: 'quarantined' }]} />)
  expect(screen.getByText('検査中です')).toBeTruthy()
  expect(screen.getByText('危ないファイルのため開けません')).toBeTruthy()
  expect(fetchApiBlob).not.toHaveBeenCalled()
  expect(screen.queryByRole('button')).toBeNull()
})
