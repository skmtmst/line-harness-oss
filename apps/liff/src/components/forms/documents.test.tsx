// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FormFileControl } from './controls'
afterEach(cleanup)
describe('書類の入力', () => {
  it.each([
    { kind: 'identity' as const, bothSides: true },
    { kind: 'identity' as const, bothSides: false },
    { kinds: ['image', 'pdf', 'identity'] as ('image' | 'pdf' | 'identity')[], bothSides: true },
  ])('過去の本人確認設定は新規受付・撮影・選び直しを出さない（%j）', props => {
    const upload = vi.fn(), remove = vi.fn()
    const { container, rerender } = render(<FormFileControl label="本人確認" {...props} onUpload={upload} onRemove={remove} />)
    expect(screen.getByRole('alert').textContent).toContain('本人確認書類は受け付けていません')
    expect(container.querySelector('input[type=file]')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    rerender(<FormFileControl label="本人確認" {...props} files={[
      { fileId: 'front', kind: 'identity', side: 'front', filename: 'private-front.png', state: 'ready' },
      { fileId: 'back', kind: 'identity', side: 'back', filename: 'private-back.png', state: 'pending' },
    ]} onUpload={upload} onRemove={remove} />)
    expect(screen.getByRole('alert').textContent).toContain('店舗にお問い合わせください')
    expect(container.querySelector('input[type=file]')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.textContent).not.toContain('private-')
    expect(upload).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
  it('写真とPDFの受付は保ち、既存設定を変更した時だけ選べる', () => {
    const upload = vi.fn()
    const { container, rerender } = render(<FormFileControl label="添付" kind="identity" onUpload={upload} />)
    rerender(<FormFileControl label="添付" kinds={['image', 'pdf']} onUpload={upload} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    expect(input.accept).toContain('image/png')
    expect(input.accept).toContain('application/pdf')
    const image = new File(['png'], 'photo.png', { type: 'image/png' })
    fireEvent.click(screen.getByRole('button', { name: '写真を選ぶ' }))
    fireEvent.change(input, { target: { files: [image] } })
    expect(upload).toHaveBeenCalledWith(image, 'single')
    rerender(<FormFileControl label="PDF" kind="pdf" onUpload={upload} />)
    expect(input.accept).toBe('application/pdf')
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
  it('写真は検査中を示し、選び直しを開いただけでは添付を外さない', () => {
    const remove = vi.fn(), upload = vi.fn()
    const photo = { fileId: 'photo', side: 'single' as const, filename: 'photo.png', mimeType: 'image/png', previewUrl: 'blob:photo', state: 'pending' as const }
    const { container, rerender } = render(<FormFileControl label="写真" files={[photo]} onRemove={remove} onUpload={upload} />)
    expect(screen.getByAltText('送った写真')).toBeTruthy()
    expect(screen.getByText('photo.png（検査中）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '撮り直す・選び直す' }))
    expect(remove).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'photo.pngを外して選び直す', hidden: true }))
    expect(remove).toHaveBeenCalledWith('photo')
    rerender(<FormFileControl label="写真" files={[]} onRemove={remove} onUpload={upload} />)
    const image = new File(['png'], 'new.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [image] } })
    expect(upload).toHaveBeenCalledWith(image, 'single')
  })
  it('アップロード中は写真を外す・選び直す操作を止める', () => {
    const remove = vi.fn()
    render(<FormFileControl label="写真" uploading onRemove={remove} files={[
      { fileId: 'photo', side: 'single', filename: 'photo.png', state: 'ready' },
    ]} />)
    expect((screen.getByRole('button', { name: 'photo.pngを外す' }) as HTMLButtonElement).disabled).toBe(true)
    const summary = screen.getByRole('button', { name: '撮り直す・選び直す' })
    expect((summary as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(summary)
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'photo.pngを外して選び直す' })).toBeNull()
    expect(remove).not.toHaveBeenCalled()
  })
})
