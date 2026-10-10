// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FormFileControl } from './controls'
afterEach(cleanup)
describe('書類の入力', () => {
  it('写真は表・裏で選び、PDFはファイルだけを選ぶ', () => {
    const upload = vi.fn()
    const { container, rerender } = render(<FormFileControl label="本人確認" kind="identity" bothSides onUpload={upload} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    expect(screen.getByRole('group', { name: '表' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '裏' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '裏（写真を入れる）' })); fireEvent.click(screen.getByRole('button', { name: '写真を選ぶ' }))
    const image = new File(['png'], 'back.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [image] } })
    expect(upload).toHaveBeenCalledWith(image, 'back')
    rerender(<FormFileControl label="PDF" kind="pdf" onUpload={upload} />)
    expect(input.accept).toBe('application/pdf')
    expect(screen.getByText('危ないファイルの検査は内蔵の検査が標準です。外部の検査は設定した店だけで行います。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '写真を撮る' })).toBeNull()
  })
  it('送信前に形式と10MBを断り、アップロード中は選べない', () => {
    const upload = vi.fn()
    const { container, rerender } = render(<FormFileControl label="書類" kind="pdf" onUpload={upload} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['png'], 'a.png', { type: 'image/png' })] } })
    expect(upload).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('形式')
    const large = new File([new Uint8Array(10485761)], 'large.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [large] } })
    expect(upload).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('10MB')
    rerender(<FormFileControl label="書類" kind="pdf" uploading onUpload={upload} />)
    expect((screen.getByRole('button', { name: 'ファイルを選ぶ' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('上限の枚数を越えさせず、×で外す', () => {
    const remove = vi.fn()
    render(<FormFileControl label="PDF" kind="pdf" maxCount={1} files={[{ fileId: 'file', filename: '申込.pdf', side: 'single', mimeType: 'application/pdf', state: 'ready' }]} onRemove={remove} />)
    expect(screen.queryByRole('button', { name: 'ファイルを選ぶ' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '申込.pdfを外す' }))
    expect(remove).toHaveBeenCalledWith('file')
  })
})
