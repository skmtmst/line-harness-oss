// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { schedule, image } = vi.hoisted(() => ({ schedule: vi.fn(), image: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { templates: { list: vi.fn(async () => ({ success: true, data: [] })) }, uploads: { image }, chats: { schedule } } }))
import ScheduleDialog from './schedule-dialog'

const uploadedUrl = 'https://images.test/notice.png'
beforeEach(() => {
  image.mockReset().mockResolvedValue({ success: true, data: { url: uploadedUrl } })
  schedule.mockReset().mockResolvedValue({ success: true, data: { id: 'scheduled' } })
})
afterEach(cleanup)
function open() {
  const onClose = vi.fn(), onReserved = vi.fn()
  render(<ScheduleDialog friendId="friend" friendName="ソラ" accountId="account" onClose={onClose} onReserved={onReserved} />)
  return { onClose, onReserved }
}
async function upload(size = 20) {
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'.repeat(size)], 'notice.png', { type: 'image/png' })] } })
  if (size <= 1024 * 1024) await screen.findByAltText('予約する画像')
}
const reserve = () => fireEvent.click(screen.getByRole('button', { name: /に予約$/ }))

it('画像だけでも予約でき、画像のURL対と日本時間を予約の口へ渡す', async () => {
  const { onClose } = open()
  await upload()
  reserve()
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(schedule.mock.calls[0][1]).toMatchObject({ messageType: 'image', content: JSON.stringify({ originalContentUrl: uploadedUrl, previewImageUrl: uploadedUrl }) })
  expect(schedule.mock.calls[0][1].scheduledAt).toMatch(/T09:00:00\+09:00$/)
})

it('画像の成功後に文が通信失敗した場合、文だけを同じ鍵で再試行する', async () => {
  const { onClose, onReserved } = open()
  await upload()
  fireEvent.change(screen.getByRole('textbox', { name: '送るもの' }), { target: { value: '明日のご案内です' } })
  schedule.mockResolvedValueOnce({ success: true, data: { id: 'image' } }).mockRejectedValueOnce(new Error('network'))
  reserve()
  await screen.findByText(/1件は予約済みです/)
  expect(onClose).not.toHaveBeenCalled()
  expect(onReserved).toHaveBeenCalledTimes(1)
  expect(screen.queryByAltText('予約する画像')).toBeNull()
  expect((screen.getByRole('textbox', { name: '送るもの' }) as HTMLTextAreaElement).value).toBe('明日のご案内です')
  const key = schedule.mock.calls[1][2]
  reserve()
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(schedule).toHaveBeenCalledTimes(3)
  expect(schedule.mock.calls[2]).toEqual(schedule.mock.calls[1])
  expect(schedule.mock.calls[2][2]).toBe(key)
})

it('画像の結果が不明なら画像を残し、同じ日時と内容では同じ鍵を使う', async () => {
  open()
  await upload()
  schedule.mockRejectedValueOnce(new Error('network'))
  reserve()
  await screen.findByText(/予約できませんでした/)
  expect(screen.getByAltText('予約する画像')).toBeTruthy()
  const first = schedule.mock.calls[0]
  reserve()
  await waitFor(() => expect(schedule).toHaveBeenCalledTimes(2))
  expect(schedule.mock.calls[1]).toEqual(first)
})

it('1MBを超える画像は準備せず、理由を表示する', async () => {
  open()
  await upload(1024 * 1024 + 1)
  await screen.findByText(/画像が大きすぎます/)
  expect(image).not.toHaveBeenCalled()
  expect(schedule).not.toHaveBeenCalled()
})
