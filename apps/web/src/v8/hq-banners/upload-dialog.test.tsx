// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UploadDialogV8 } from './dialogs'

const mocks = vi.hoisted(() => { process.env.NEXT_PUBLIC_API_URL ||= 'http://worker.test'; return { list: vi.fn(), upload: vi.fn() } })
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, hqBanners: { ...actual.api.hqBanners, projects: { ...actual.api.hqBanners.projects, list: mocks.list, upload: mocks.upload } } } }
})
vi.mock('@/lib/hq-banners', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/hq-banners')>(), readFileAsBase64: vi.fn().mockResolvedValue('image-data'),
}))

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  mocks.list.mockResolvedValue({ success: true, data: [{ id: 'p1', name: 'プロジェクト' }] })
  mocks.upload.mockReset()
})
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

it('取込み先は必須で、画像を選ぶまで送らない', async () => {
  render(<UploadDialogV8 open onClose={() => {}} onDone={() => {}} />)
  const project = await screen.findByRole('button', { name: /入れるプロジェクト/ })
  const field = project.closest('[data-form-requirement]')
  expect(field?.textContent).toContain('必須')
  const confirm = screen.getByRole('button', { name: '取り込む' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(mocks.upload).not.toHaveBeenCalled()
})

it('選んだ画像は確認後だけ送り、失敗しても再試行できる', async () => {
  mocks.upload.mockResolvedValueOnce({ success: false, error: '画像を取り込めませんでした' })
  mocks.upload.mockResolvedValueOnce({ success: true, data: {} })
  const done = vi.fn()
  render(<UploadDialogV8 open onClose={() => {}} onDone={done} />)
  await screen.findByRole('group', { name: '選択中の入れるプロジェクト：プロジェクト' })
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'sample.png', { type: 'image/png' })] } })
  expect(mocks.upload).not.toHaveBeenCalled()
  const confirm = screen.getByRole('button', { name: '取り込む' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
  await screen.findByText('画像を取り込めませんでした')
  expect(done).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('sample.png')
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
  await waitFor(() => expect(done).toHaveBeenCalledWith('p1'))
  expect(mocks.upload).toHaveBeenCalledTimes(2)
  expect(mocks.upload).toHaveBeenLastCalledWith('p1', { filename: 'sample.png', mimeType: 'image/png', data: 'image-data' })
})
