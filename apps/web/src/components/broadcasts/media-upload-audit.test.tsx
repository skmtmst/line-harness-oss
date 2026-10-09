// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const upload = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async original => { const actual = await original<typeof import('@/lib/api')>(); return { ...actual, api: { ...actual.api, broadcastMessageAssets: { upload } } } })
import { MediaUpload } from './broadcast-form'
afterEach(cleanup)
it('WEB255: 動画画像待ちの間に直したプレビューURLと本文を残す', async () => {
  let complete!: (v: unknown) => void
  upload.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const change = vi.fn()
  const bubble = { id: 'B', type: 'video', content: { previewImageUrl: 'https://example.com/old.png', text: '元' } }
  const view = render(<MediaUpload bubble={bubble} onChange={change} lineAccountId="a" />)
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['video'], 'a.mp4', { type: 'video/mp4' })] } })
  view.rerender(<MediaUpload bubble={{ ...bubble, content: { previewImageUrl: 'https://example.com/new.png', text: '新' } }} onChange={change} lineAccountId="a" />)
  await act(async () => complete({ success: true, data: { url: 'https://example.com/a.mp4' } }))
  expect(change).toHaveBeenLastCalledWith({ originalContentUrl: 'https://example.com/a.mp4', previewImageUrl: 'https://example.com/new.png', text: '新' })
})
it('WEB255: 別の吹き出しへ切り替えたら前の画像を入れない', async () => {
  let complete!: (v: unknown) => void
  upload.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const change = vi.fn()
  const view = render(<MediaUpload bubble={{ id: 'A', type: 'image', content: {} }} onChange={change} lineAccountId="a" />)
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'a.png', { type: 'image/png' })] } })
  view.rerender(<MediaUpload bubble={{ id: 'B', type: 'image', content: {} }} onChange={change} lineAccountId="a" />)
  await act(async () => complete({ success: true, data: { url: 'https://example.com/a.png' } }))
  expect(change).not.toHaveBeenCalled()
})
