// @vitest-environment happy-dom
/*
 * 動画・音声の欄は画像を入れる所（MediaSlot・Z7vd2）で入れる。
 * 音声の長さはファイルから読み、読めないときだけ手で入れる欄を出す。
 * アカウントが無い所（統括）はファイルを受け取らず URL だけ。
 */
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const upload = vi.hoisted(() => vi.fn())
const metadata = vi.hoisted(() => vi.fn())
vi.mock('@/components/shared/media-library-upload', () => ({ uploadToMediaLibrary: upload }))
vi.mock('@/v8/contents/media-direct-upload', () => ({ extractMediaMetadata: metadata }))

import MessageKindFields, { emptyMessageKindState, type MessageKind, type MessageKindState } from './message-kind-fields'

let last: MessageKindState | null = null
function Host({ kind, accountId }: { kind: MessageKind; accountId?: string | null }) {
  const [value, setValue] = useState(emptyMessageKindState())
  last = value
  return <MessageKindFields kind={kind} value={value} onChange={setValue} mediaAccountId={accountId} />
}

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ url: 'https://cdn.test/voice.m4a' })
  metadata.mockReset()
  last = null
})
afterEach(cleanup)

const m4a = () => new File(['a'], 'voice.m4a', { type: 'audio/mp4' })
const choose = (name: string, file: File) =>
  fireEvent.change(screen.getByLabelText(`${name}（ファイル）`), { target: { files: [file] } })

it('音声：ファイルから長さを読めたら一緒に入れ、手で入れる欄は出さない', async () => {
  metadata.mockResolvedValue({ durationMs: 12500 })
  render(<Host kind="audio" accountId="acc-1" />)
  await act(async () => { choose('音声を追加', m4a()) })
  expect(upload).toHaveBeenCalledWith(expect.any(File), 'acc-1', 'audio', expect.any(Function))
  expect(last?.audio).toEqual({ originalContentUrl: 'https://cdn.test/voice.m4a', duration: '12.5' })
  expect(screen.getByText(/長さ 12.5 秒（ファイルから読みました）/)).toBeTruthy()
  expect(screen.queryByText('長さ（秒）', { exact: false })).toBeNull()
})

it('音声：長さを読めなかったときだけ手で入れる欄を出す', async () => {
  metadata.mockResolvedValue({})
  render(<Host kind="audio" accountId="acc-1" />)
  await act(async () => { choose('音声を追加', m4a()) })
  expect(last?.audio.originalContentUrl).toBe('https://cdn.test/voice.m4a')
  expect(screen.getByText('長さ（秒）', { exact: false })).toBeTruthy()
})

it('統括（アカウント無し）はファイルを受け取らず、URL で入れる', () => {
  render(<Host kind="audio" accountId={null} />)
  expect(screen.queryByText(/ドラッグ＆ドロップ/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'URL で入れる' }))
  fireEvent.change(screen.getByRole('textbox', { name: '音声のURL' }), { target: { value: 'https://cdn.test/a.m4a' } })
  expect(last?.audio.originalContentUrl).toBe('https://cdn.test/a.m4a')
  expect(screen.getByText('長さ（秒）', { exact: false })).toBeTruthy()
})

it('動画：動画の枠とプレビュー画像の小さい枠を並べる', async () => {
  upload.mockResolvedValueOnce({ url: 'https://cdn.test/movie.mp4' }).mockResolvedValueOnce({ url: 'https://cdn.test/thumb.png' })
  render(<Host kind="video" accountId="acc-1" />)
  await act(async () => { choose('動画を追加', new File(['v'], 'movie.mp4', { type: 'video/mp4' })) })
  await act(async () => { choose('プレビュー画像を追加', new File(['i'], 'thumb.png', { type: 'image/png' })) })
  expect(last?.video).toEqual({ originalContentUrl: 'https://cdn.test/movie.mp4', previewImageUrl: 'https://cdn.test/thumb.png' })
})
