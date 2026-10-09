// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BroadcastBubble } from '@line-crm/shared'
const mocks = vi.hoisted(() => ({ upload: vi.fn(), play: vi.fn(), pause: vi.fn(), picker: vi.fn() }))
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {}, api: { broadcastMessageAssets: { upload: mocks.upload } } }))
vi.mock('@/components/shared/media-picker-dialog', () => ({ default: (props: unknown) => { mocks.picker(props); return null } }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
import Media from './message-composer-media'
const bubble: BroadcastBubble = { id: 'image', type: 'image', content: { originalContentUrl: 'https://example.com/original.jpg', fileName: '元の画像.jpg' } }
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)
const choose = (container: HTMLElement) => fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['image'], 'new.jpg', { type: 'image/jpeg' })] } })
it('アップロード失敗時は選んだ画像を置き換えず、再試行できる', async () => {
  mocks.upload.mockResolvedValueOnce({ success: false, error: '画像を登録できませんでした。' }).mockResolvedValueOnce({ success: true, data: { url: 'https://example.com/new.jpg' } })
  const change = vi.fn(); const busy = vi.fn()
  const { container } = render(<Media bubble={bubble} accountId="a" onChange={change} onBusyChange={busy} />)
  choose(container)
  await screen.findByRole('alert'); expect(change).not.toHaveBeenCalled()
  expect(screen.getByAltText('画像のプレビュー').getAttribute('src')).toBe('https://example.com/original.jpg')
  choose(container)
  await waitFor(() => expect(change).toHaveBeenCalledWith(expect.objectContaining({ originalContentUrl: 'https://example.com/new.jpg' })))
  expect(mocks.upload).toHaveBeenCalledWith(expect.any(File), 'a'); expect(busy.mock.calls.map(call => call[0])).toEqual([true, false, true, false])
})
it('アカウント切替で外れた欄に古いアップロード結果を反映しない', async () => {
  let resolve!: (result: unknown) => void
  mocks.upload.mockReturnValue(new Promise(done => { resolve = done }))
  const change = vi.fn()
  const { container, unmount } = render(<Media bubble={bubble} accountId="a" onChange={change} />)
  choose(container); choose(container); expect(mocks.upload).toHaveBeenCalledTimes(1)
  unmount(); resolve({ success: true, data: { url: 'https://example.com/new.jpg' } })
  await waitFor(() => expect(change).not.toHaveBeenCalled())
})
it('音声を再生・停止でき、再生位置を更新する', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { fireEvent.play(this); return Promise.resolve() })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { fireEvent.pause(this) })
  const { container } = render(<Media bubble={{ id: 'audio', type: 'audio', content: { fileName: '挨拶.m4a', state: { audio: { originalContentUrl: 'https://example.com/a.m4a', duration: '42' } } } }} accountId="a" onChange={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '音声を再生する' }))
  await screen.findByRole('button', { name: '音声を停止する' })
  const audio = container.querySelector('audio')!; Object.defineProperty(audio, 'currentTime', { configurable: true, value: 12 }); fireEvent.timeUpdate(audio)
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('12')
  fireEvent.click(screen.getByRole('button', { name: '音声を停止する' })); await screen.findByRole('button', { name: '音声を再生する' })
  vi.restoreAllMocks()
})

it('登録メディアにもLINEで使える形式を求め、使えない動画で元の内容を置き換えない', async () => {
  const change = vi.fn()
  render(<Media bubble={{ id: 'v', type: 'video', content: { originalContentUrl: 'https://example.com/original.mp4' } }} accountId="a" onChange={change} />)
  const { onSelect } = mocks.picker.mock.calls.at(-1)![0] as { onSelect: (item: unknown) => void }
  act(() => onSelect({ id: 'bad', kind: 'video', mimeType: 'video/webm', sizeBytes: 1024, url: 'https://example.com/a.webm', filename: 'a.webm' }))
  expect(screen.getByRole('alert').textContent).toContain('使える形式'); expect(change).not.toHaveBeenCalled()
  act(() => onSelect({ id: 'good', kind: 'video', mimeType: 'video/mp4', sizeBytes: 1024, url: 'https://example.com/a.mp4', filename: 'a.mp4' }))
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ originalContentUrl: 'https://example.com/a.mp4' }))
})
