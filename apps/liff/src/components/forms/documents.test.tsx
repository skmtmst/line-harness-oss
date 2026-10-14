// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  it('表裏の写真と×は同じ枠に置き、検査中の写真にも状態を出す', () => {
    const remove = vi.fn()
    render(<FormFileControl label="本人確認" kind="identity" bothSides onRemove={remove} files={[
      { fileId: 'front', side: 'front', filename: 'front.png', mimeType: 'image/png', previewUrl: 'blob:front', state: 'pending' },
      { fileId: 'back', side: 'back', filename: 'back.png', mimeType: 'image/png', previewUrl: 'blob:back', state: 'ready' },
    ]} />)
    for (const [side, filename] of [['表', 'front.png'], ['裏', 'back.png']]) {
      const group = within(screen.getByRole('group', { name: side }))
      const image = group.getByAltText('送った写真')
      const button = group.getByRole('button', { name: `${filename}を外す` })
      expect(image.parentElement?.parentElement).toBe(button.parentElement)
      expect(group.getAllByRole('button')).toHaveLength(2)
    }
    expect(screen.getByText('front.png（検査中）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'back.pngを外す' }))
    expect(remove).toHaveBeenCalledWith('back')
  })
  it('選び直しを開くときは添付を保ち、選んだ片面だけ外して再選択する', () => {
    const remove = vi.fn(), upload = vi.fn()
    const front = { fileId: 'front', side: 'front' as const, filename: 'front.png', mimeType: 'image/png', state: 'ready' as const }
    const back = { ...front, fileId: 'back', side: 'back' as const, filename: 'back.png' }
    const { container, rerender } = render(<FormFileControl label="本人確認" kind="identity" bothSides files={[front, back]} onRemove={remove} onUpload={upload} />)
    fireEvent.click(screen.getByRole('button', { name: '撮り直す・選び直す' }))
    expect(remove).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '裏を外して選び直す', hidden: true }))
    expect(remove).toHaveBeenCalledWith('back')
    rerender(<FormFileControl label="本人確認" kind="identity" bothSides files={[front]} onRemove={remove} onUpload={upload} />)
    fireEvent.click(screen.getByRole('button', { name: '写真を選ぶ' }))
    const image = new File(['png'], 'new-back.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [image] } })
    expect(upload).toHaveBeenCalledWith(image, 'back')
    expect(screen.getByRole('button', { name: 'front.pngを外す' })).toBeTruthy()
  })
  it('アップロード中は外す・片面選択・選び直しを止める', () => {
    const remove = vi.fn()
    render(<FormFileControl label="本人確認" kind="identity" bothSides uploading onRemove={remove} files={[
      { fileId: 'front', side: 'front', filename: 'front.png', state: 'ready' },
      { fileId: 'back', side: 'back', filename: 'back.png', state: 'ready' },
    ]} />)
    for (const name of ['front.pngを外す', 'back.pngを外す', '表を選ぶ', '裏を選ぶ']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    const summary = screen.getByRole('button', { name: '撮り直す・選び直す' })
    expect((summary as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(summary)
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: '表を外して選び直す' })).toBeNull()
    expect(remove).not.toHaveBeenCalled()
  })
})
