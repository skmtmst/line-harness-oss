// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

/*
 * カルーセルの保存で落ちた欄（B-139・オーナーの写真の指摘：「すべてのカードに本文を入力してください」の帯だけだった）。
 * 欄が赤くなり真下に理由、別のカードならそのカードを開いて移り、カードの札に赤い丸が付く。
 */
beforeEach(() => { calls.create.mockResolvedValue({ success: true, data: { id: 'template-1' } }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

const fillFirst = () => {
  fireEvent.change(screen.getByPlaceholderText('例：夏の定番5点'), { target: { value: '夏の定番' } })
  fireEvent.change(screen.getByLabelText('タイトル（40文字まで）'), { target: { value: '1枚目' } })
  fireEvent.change(screen.getByLabelText(/本文（/), { target: { value: '1枚目の本文' } })
}

describe('カルーセルの欄ごとの誤り（B-139）', () => {
  it('2枚目の本文が空なら送らず、2枚目を開いて本文の欄を赤くし、真下に理由を出してそこへ移る。札に赤い丸', async () => {
    render(<Carousel />)
    fillFirst()
    fireEvent.click(screen.getByRole('button', { name: 'カードを足す' }))
    fireEvent.click(screen.getByRole('button', { name: /^1 / }))
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'カード 2 の中身' })).toBeTruthy())
    const body = document.getElementById('cr-text') as HTMLInputElement
    expect(body.value).toBe('')
    expect(body.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('cr-text-error')?.textContent).toBe('本文を入力してください')
    expect(screen.queryByText('すべてのカードに本文を入力してください')).toBeNull()
    expect(screen.getByRole('img', { name: 'カード2に直す欄が1か所' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: /カード1に直す欄/ })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(body))
    expect(calls.create).not.toHaveBeenCalled()
    /* 直すと赤と丸が消え、保存できる。 */
    fireEvent.change(body, { target: { value: '2枚目の本文' } })
    expect(body.getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByRole('img', { name: /直す欄/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalled())
  })

  it('名前が空・ボタンの送る文が空なら、それぞれの欄に理由を出し、1つ目（名前）へ移る', async () => {
    render(<Carousel />)
    fireEvent.change(screen.getByLabelText(/本文（/), { target: { value: '本文' } })
    fireEvent.change(screen.getByLabelText('カード1のボタン1の文字'), { target: { value: '聞く' } })
    fireEvent.click(screen.getByRole('button', { name: 'カード1のボタン1の動き' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('テキストを送る'))
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    const name = screen.getByPlaceholderText('例：夏の定番5点')
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    expect(document.getElementById('cr-name-input-error')?.textContent).toBe('名前を入力してください')
    expect(document.getElementById('cr-button-0-error')?.textContent).toBe('送る文を入力してください')
    await waitFor(() => expect(document.activeElement).toBe(name))
    expect(calls.create).not.toHaveBeenCalled()
  })
})
