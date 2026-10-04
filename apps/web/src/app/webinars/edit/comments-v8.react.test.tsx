// @vitest-environment happy-dom
/*
 * ★V8 コメント演出（`Omqd4`）の描画。
 * 差し替えるのは通信だけ。一覧・追加・貼り付け・保存が実在する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  comments: vi.fn(),
  saveComments: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      comments: apiMocks.comments,
      saveComments: apiMocks.saveComments,
    },
  }
})

import CommentsV8 from './comments-v8'

let mounted: Root[] = []

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  mounted.push(root)
  act(() => {
    root.render(<CommentsV8 webinarId="webinar-1" />)
  })
  return host
}

describe('コメント演出のV8（Omqd4）', () => {
  beforeEach(() => {
    apiMocks.comments.mockResolvedValue({
      data: [{ atSeconds: 10, authorName: '田中', body: 'こんばんは' }],
    })
    apiMocks.saveComments.mockResolvedValue({ data: { count: 1 } })
  })

  afterEach(() => {
    act(() => { mounted.forEach((root) => root.unmount()); mounted = [] })
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('板IDと一覧・追加・保存を描く', async () => {
    const host = render()
    await act(async () => undefined)
    await act(async () => undefined)
    expect(host.querySelector('[data-design-node="Omqd4"]')).not.toBeNull()
    expect(host.textContent).toContain('コメント演出')
    // 名前と本文は入力欄の値として描かれる（textContent には出ない）。
    const nameInput = host.querySelector('input[aria-label="1行目の名前"]') as HTMLInputElement | null
    expect(nameInput?.value).toBe('田中')
    expect(host.textContent).toContain('保存する')
  })

  it('空の名前・本文の追加行は送信せず、入力を残して直せる', async () => {
    const host = render()
    await act(async () => undefined)
    const add = [...host.querySelectorAll('button')].find((el) => el.textContent === '＋ 追加')
    await act(async () => {
      add!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const save = [...host.querySelectorAll('button')].find((el) => el.textContent === '保存する')
    await act(async () => {
      save!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.saveComments).not.toHaveBeenCalled()
    expect(host.textContent).toContain('2行目を確認してください')
    expect(host.querySelector('input[aria-label="2行目の名前"]')).not.toBeNull()
  })

  it('読み込み失敗は空や保存可能にせず、読み直して復帰する', async () => {
    apiMocks.comments.mockRejectedValueOnce(new Error('通信切れ'))
    const host = render()
    await act(async () => undefined)
    expect(host.textContent).toContain('コメントを読み込めませんでした')
    const buttons = () => [...host.querySelectorAll('button')]
    expect((buttons().find((element) => element.textContent === '保存する') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).not.toContain('まだコメントがありません')
    await act(async () => { buttons().find((element) => element.textContent === 'もう一度読み込む')!.click() })
    expect((host.querySelector('input[aria-label="1行目の名前"]') as HTMLInputElement).value).toBe('田中')
  })

  it('保存失敗は入力を残し、二重クリックを一回にしてやり直せる', async () => {
    let reject!: (error: Error) => void
    apiMocks.saveComments.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
    const host = render()
    await act(async () => undefined)
    const save = () => [...host.querySelectorAll('button')].find((element) => element.textContent === '保存する')!
    await act(async () => { save().click(); save().click() })
    expect(apiMocks.saveComments).toHaveBeenCalledTimes(1)
    await act(async () => { reject(new Error('通信切れ')) })
    expect(host.textContent).toContain('入力を残しました')
    expect((host.querySelector('input[aria-label="1行目のコメント"]') as HTMLInputElement).value).toBe('こんばんは')
    await act(async () => { save().click() })
    expect(apiMocks.saveComments).toHaveBeenCalledTimes(2)
    expect(apiMocks.saveComments.mock.calls[1][1]).toEqual([{ atSeconds: 10, authorName: '田中', body: 'こんばんは' }])
    expect(host.textContent).toContain('1件保存しました')
  })

})
