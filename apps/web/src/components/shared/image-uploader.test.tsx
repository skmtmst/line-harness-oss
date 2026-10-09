// @vitest-environment happy-dom
/*
 * 共通の画像の取り込み（ImageUploader）：遅れて返った前の取り込みで、
 * あとから選んだ画像・取り消しを上書きしない（監査 WEB-026）。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const image = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { uploads: { image } } }))

import ImageUploader, { type ImageUploaderValue } from './image-uploader'

type Deferred = { resolve: (url: string) => void }
let pending: Deferred[] = []
beforeEach(() => {
  pending = []
  image.mockReset().mockImplementation(() => new Promise((resolve) => {
    pending.push({ resolve: (url) => resolve({ success: true, data: { url } }) })
  }))
})
afterEach(cleanup)

const png = (name: string) => new File(['x'], name, { type: 'image/png' })
function paste(target: Element, file: File) {
  fireEvent.paste(target, { clipboardData: { items: [{ type: file.type, getAsFile: () => file }] } })
}

it('先に選んだ画像の返事が後から来ても、あとで選んだ画像のままにする', async () => {
  const onChange = vi.fn()
  render(<ImageUploader mode="url" value={null} onChange={onChange} />)
  const zone = screen.getByRole('group', { name: '画像を追加' })
  paste(zone, png('first.png'))
  paste(zone, png('second.png'))
  expect(pending).toHaveLength(2)
  await act(async () => { pending[1].resolve('https://cdn.test/second.png') })
  await act(async () => { pending[0].resolve('https://cdn.test/first.png') })
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'url', url: 'https://cdn.test/second.png' })
})

it('取り込み中に URL を手で入れたら、返事が来ても画像を戻さない', async () => {
  const onChange = vi.fn()
  const { rerender } = render(<ImageUploader mode="url" value={null} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'URL で入れる' }))
  paste(screen.getByRole('group', { name: '画像を追加' }), png('new.png'))
  fireEvent.change(screen.getByRole('textbox', { name: '画像の URL' }), { target: { value: 'https://cdn.test/typed.png' } })
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'url', url: 'https://cdn.test/typed.png' })
  rerender(<ImageUploader mode="url" value={{ mode: 'url', url: 'https://cdn.test/typed.png' }} onChange={onChange} />)
  await act(async () => { pending[0].resolve('https://cdn.test/new.png') })
  expect(onChange).toHaveBeenCalledTimes(1)
})

it('入った画像を「消す」と null', () => {
  const onChange = vi.fn()
  render(<ImageUploader mode="url" value={{ mode: 'url', url: 'https://cdn.test/old.png' }} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: '消す' }))
  expect(onChange).toHaveBeenLastCalledWith(null)
})
