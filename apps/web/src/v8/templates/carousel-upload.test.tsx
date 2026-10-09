// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateEditHost } from '../template-edit/host'

const calls = vi.hoisted(() => ({ prepare: vi.fn(), put: vi.fn(), complete: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error {}, api: {
  media: { prepareUploads: calls.prepare, completeUpload: calls.complete, detail: calls.detail },
  templates: { create: calls.create, update: calls.update }, folders: { list: async () => ({ success: true, data: [] }) },
} }))
vi.mock('../contents/media-direct-upload', async (original) => ({
  ...await original<Record<string, unknown>>(), extractMediaMetadata: async () => ({ width: 1040, height: 1040 }), putMediaFile: calls.put,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a-1', selectedAccount: { name: '店' }, accounts: [] }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-capability', () => ({ isOwnerOrAdmin: () => true }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({ useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }) }))
import Carousel from './carousel'

const file = (type = 'image/png', name = 'card.png') => new File(['image'], name, { type })
const choose = (chosen: File) => fireEvent.change(screen.getByLabelText('カードの画像ファイル'), { target: { files: [chosen] } })
const fill = () => {
  fireEvent.change(screen.getByPlaceholderText('例：夏の定番5点'), { target: { value: '手元の画像' } })
  fireEvent.change(screen.getByLabelText('タイトル（40文字まで）'), { target: { value: 'カードの題' } })
  fireEvent.change(screen.getByLabelText(/本文（タイトルか画像があると/), { target: { value: '書いた本文' } })
}
const host = (patch: Partial<TemplateEditHost> = {}): TemplateEditHost => ({ description: '', folders: [], folder: '', onFolderChange: vi.fn(), busy: false, onSave: vi.fn(), onCancel: vi.fn(), ...patch })
const image = { id: 'img-1', kind: 'image' as const, filename: 'card.png', mimeType: 'image/png', sizeBytes: 5, width: 1040, height: 1040, durationMs: null, r2Key: 'hq/card.png', publicUrl: 'https://img.test/card.png', versionId: 'v1', versionNo: 1, contentHash: 'hash' }
beforeEach(() => {
  calls.prepare.mockResolvedValue({ success: true, data: { sessions: [{ id: 'session-1' }] } })
  calls.put.mockResolvedValue('etag')
  calls.complete.mockResolvedValue({ success: true, data: { status: 'completed', mediaId: 'media-1' } })
  calls.detail.mockResolvedValue({ success: true, data: { item: { kind: 'image', url: image.publicUrl } } })
  calls.create.mockResolvedValue({ success: true, data: { id: 'template-1' } })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('カルーセルに手元の画像を入れる', () => {
  it.each([['image/png', 'card.png'], ['image/jpeg', 'card.jpg']])('%sは登録メディアへ送り、カードと保存内容に入る', async (type, filename) => {
    render(<Carousel />); fill(); const chosen = file(type, filename); choose(chosen)
    await waitFor(() => expect(screen.getByAltText('カードの画像').getAttribute('src')).toBe(image.publicUrl))
    expect(calls.prepare.mock.calls[0][0]).toMatchObject({ accountId: 'a-1', files: [{ filename, mimeType: type }] })
    expect(calls.put).toHaveBeenCalledWith({ id: 'session-1' }, chosen, expect.any(Function))
    expect(calls.complete).toHaveBeenCalledWith('session-1', { accountId: 'a-1', etag: 'etag' })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    expect(JSON.parse(calls.create.mock.calls[0][0].messageContent)[0]).toMatchObject({ thumbnailImageUrl: image.publicUrl, text: '書いた本文' })
  })
  it('ドラッグでも受け取り、処理中は保存・複製・カード選び・二重送信を止める', async () => {
    let finish!: (value: string) => void
    calls.put.mockReturnValue(new Promise<string>((resolve) => { finish = resolve }))
    render(<Carousel />); fill()
    fireEvent.drop(screen.getByRole('group', { name: 'カードの画像' }), { dataTransfer: { files: [file()] } })
    await waitFor(() => expect(calls.put).toHaveBeenCalled())
    for (const name of ['下書きを保存', '保存して公開', 'このカードを複製', 'カードを足す']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '1 カードの題' }) as HTMLButtonElement).disabled).toBe(true)
    choose(file()); expect(calls.prepare).toHaveBeenCalledTimes(1)
    await act(async () => finish('etag'))
    await waitFor(() => expect(screen.getByAltText('カードの画像')).toBeTruthy())
  })
  it('形式・拡張子・空の画像・10MB超を送る前に止め、本文を残す', async () => {
    render(<Carousel />); fill()
    const tooLarge = file(); Object.defineProperty(tooLarge, 'size', { value: 10 * 1024 * 1024 + 1 })
    for (const chosen of [file('image/gif', 'card.gif'), file('image/png', 'card.jpg'), new File([], 'empty.png', { type: 'image/png' }), tooLarge]) {
      choose(chosen); expect(screen.getByRole('alert')).toBeTruthy(); expect(calls.prepare).not.toHaveBeenCalled()
      expect((screen.getByLabelText(/本文（タイトルか画像があると/) as HTMLTextAreaElement).value).toBe('書いた本文')
    }
  })
  it('店の送信失敗は理由を出し、書いた内容とファイルを残して再試行する', async () => {
    calls.put.mockRejectedValueOnce(new Error('ファイルを送信できませんでした'))
    render(<Carousel />); fill(); choose(file())
    expect((await screen.findByRole('alert')).textContent).toBe('ファイルを送信できませんでした')
    expect((screen.getByLabelText('タイトル（40文字まで）') as HTMLInputElement).value).toBe('カードの題')
    expect((screen.getByLabelText(/本文（/) as HTMLTextAreaElement).value).toBe('書いた本文')
    expect(screen.getByText('card.png')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度受け取る' }))
    await waitFor(() => expect(screen.getByAltText('カードの画像')).toBeTruthy())
  })

  it('受け取り失敗でも画像・入力・ファイルを残し、同じファイルでやり直せる', async () => {
    const initial = host({ initialContent: { kind: 'carousel', name: '前の名前', tapLimitMode: 'none', tapLimitText: null, messageContent: JSON.stringify([{ thumbnailImageUrl: 'https://img.test/old.png', text: '前の本文', actions: [] }]) } })
    const upload = vi.fn().mockRejectedValueOnce(new Error('ファイルを送信できませんでした')).mockResolvedValue(image)
    render(<Carousel host={{ ...initial, uploadCarouselImage: upload }} />)
    choose(file())
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'ファイルを送信できませんでした')
    expect(screen.getByAltText('カードの画像').getAttribute('src')).toBe('https://img.test/old.png')
    expect((screen.getByLabelText(/本文（タイトルか画像があると/) as HTMLTextAreaElement).value).toBe('前の本文')
    expect(screen.getByText('card.png')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度受け取る' }))
    await waitFor(() => expect(screen.getByAltText('カードの画像').getAttribute('src')).toBe(image.publicUrl))
    expect(upload).toHaveBeenCalledTimes(2)
  })
  it('統括は統括の口を使って画像情報も保存へ渡し、8MB超を送らない', async () => {
    const upload = vi.fn().mockResolvedValue(image), save = vi.fn()
    render(<Carousel host={host({ uploadCarouselImage: upload, onSave: save })} />); fill()
    const tooLarge = file(); Object.defineProperty(tooLarge, 'size', { value: 8 * 1024 * 1024 + 1 })
    choose(tooLarge); expect(screen.getByRole('alert').textContent).toContain('8MB'); expect(upload).not.toHaveBeenCalled()
    choose(file()); await waitFor(() => expect(screen.getByAltText('カードの画像')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'carousel', media: [image] }), false)
    expect(calls.prepare).not.toHaveBeenCalled()
  })
  it.each([false, true])('画像が一部のカードだけなら保存を止める（統括=%s）', async (hq) => {
    const save = vi.fn()
    render(<Carousel {...(hq ? { host: host({ uploadCarouselImage: async () => image, onSave: save }) } : {})} />); fill()
    choose(file()); await waitFor(() => expect(screen.getByAltText('カードの画像')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'カードを足す' }))
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    expect(await screen.findByText('画像は全部のカードに入れるか、全部入れないかにしてください')).toBeTruthy()
    expect(save).not.toHaveBeenCalled(); expect(calls.create).not.toHaveBeenCalled()
  })
})
