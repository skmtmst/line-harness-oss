// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const image = vi.hoisted(() => vi.fn())
vi.mock('./media-library-upload', () => ({ uploadImageFile: image }))
import ImageUploader from './image-uploader'

afterEach(() => { cleanup(); image.mockReset() })
const reason = '閲覧のみのため画像を変えられません'
function choose(container: HTMLElement) { fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } }) }

it('画像取り込みへ理由を渡し、値と消す口を残して起動0にする', () => {
  const onChange = vi.fn()
  const view = render(<ImageUploader mode="url" value={{ mode: 'url', url: 'https://cdn.test/a.png' }} onChange={onChange} lockedReason={reason} />)
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://cdn.test/a.png')
  const remove = screen.getByRole('button', { name: '消す' }) as HTMLButtonElement
  expect(remove.disabled).toBe(false)
  expect(remove.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(remove)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.click(remove); choose(view.container)
  expect(image).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
})

it('開いたURL欄も、本人の変更後は値を保ってdisabledにし、変更を渡さない', () => {
  const onChange = vi.fn()
  const props = { mode: 'url' as const, value: null, onChange }
  const view = render(<ImageUploader {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'URL で入れる' }))
  view.rerender(<ImageUploader {...props} value={{ mode: 'url', url: 'https://cdn.test/a.png' }} lockedReason={reason} />)
  const field = screen.getByRole('textbox') as HTMLInputElement
  expect(field.disabled).toBe(true)
  expect(field.value).toBe('https://cdn.test/a.png')
  fireEvent.change(field, { target: { value: 'https://cdn.test/other.png' } })
  expect(onChange).not.toHaveBeenCalled()
})

it('URL欄の変更も、再描画前に最新の権限を確かめる', () => {
  let allowed = true
  const onChange = vi.fn()
  render(<ImageUploader mode="url" value={null} onChange={onChange} canChangeNow={() => allowed} />)
  fireEvent.click(screen.getByRole('button', { name: 'URL で入れる' }))
  allowed = false
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://cdn.test/other.png' } })
  expect(onChange).not.toHaveBeenCalled()
})

it('取り込み後にも権限を確かめ、許可中の通常uploadだけ1回反映する', async () => {
  let allowed = true, finish!: (url: string) => void
  const onChange = vi.fn()
  image.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve }))
  const view = render(<ImageUploader mode="line-image" value={null} onChange={onChange} canChangeNow={() => allowed} />)
  choose(view.container)
  expect(image).toHaveBeenCalledTimes(1)
  allowed = false
  await act(async () => finish('https://cdn.test/late.png'))
  expect(onChange).not.toHaveBeenCalled()
  allowed = true
  view.rerender(<ImageUploader mode="line-image" value={null} onChange={onChange} canChangeNow={() => allowed} />)
  choose(view.container)
  await act(async () => finish('https://cdn.test/new.png'))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ mode: 'line-image', originalContentUrl: 'https://cdn.test/new.png', previewImageUrl: 'https://cdn.test/new.png' })
})

it('本人未確定は理由なしdisabled、役割が確定した後は通常のURL入力を通す', () => {
  const onChange = vi.fn(), props = { mode: 'url' as const, value: null, onChange }
  const view = render(<ImageUploader {...props} canChangeNow={() => false} />)
  expect((screen.getByRole('button', { name: 'URL で入れる' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.container.querySelector('[data-permission-locked]')).toBeNull()
  choose(view.container)
  expect(image).not.toHaveBeenCalled()
  view.rerender(<ImageUploader {...props} canChangeNow={() => true} />)
  fireEvent.click(screen.getByRole('button', { name: 'URL で入れる' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://cdn.test/new.png' } })
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ mode: 'url', url: 'https://cdn.test/new.png' })
})
