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
  const { container } = render(<ImageUploader mode="url" value={null} onChange={onChange} />)
  const zone = container.firstElementChild!.lastElementChild as HTMLElement
  paste(zone, png('first.png'))
  paste(zone, png('second.png'))
  expect(pending).toHaveLength(2)
  await act(async () => { pending[1].resolve('https://cdn.test/second.png') })
  await act(async () => { pending[0].resolve('https://cdn.test/first.png') })
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'url', url: 'https://cdn.test/second.png' })
})

it('取り込み中に「取り消し」を押したら、返事が来ても画像を戻さない', async () => {
  const onChange = vi.fn()
  const value: ImageUploaderValue = { mode: 'url', url: 'https://cdn.test/old.png' }
  const { container } = render(<ImageUploader mode="url" value={value} onChange={onChange} />)
  const zone = container.querySelector('[tabindex="0"]') as HTMLElement
  paste(zone, png('new.png'))
  fireEvent.click(screen.getByRole('button', { name: '取り消し' }))
  expect(onChange).toHaveBeenLastCalledWith(null)
  await act(async () => { pending[0].resolve('https://cdn.test/new.png') })
  expect(onChange).toHaveBeenCalledTimes(1)
})
