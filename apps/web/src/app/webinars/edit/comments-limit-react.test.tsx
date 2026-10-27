// @vitest-environment happy-dom
/*
 * V8 ウェビナーのさくらコメントの件数上限（サーバーと同じ 200 件）。
 * 上限を超えた保存は送らずに理由を出し、まとめて貼り付けるときの案内と確かめにも同じ上限を使う。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ comments: vi.fn(), saveComments: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, webinarApi: { comments: apiMocks.comments, saveComments: apiMocks.saveComments } }
})
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())

import CommentsPane from '@/v8/webinar-edit/comments'
import { webinarDetailChrome, webinarEditContext } from '@/test-utils/webinar-edit'
import { WEBINAR_SAKURA_COMMENTS_MAX } from '@/components/webinars/webinar-limits'
import type { Webinar, WebinarEditor } from '@/lib/api'

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ atSeconds: index, authorName: `名前${index}`, body: `本文${index}` }))
let mounted: Root[] = []
let host: HTMLDivElement

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => {
    root.render(<CommentsPane ctx={webinarEditContext({ id: 'webinar-1' } as Webinar, {} as WebinarEditor)} chrome={webinarDetailChrome} onDirtyChange={() => {}} registerSave={() => {}} />)
  })
  await act(async () => undefined)
  await act(async () => undefined)
}
const button = (text: string) => [...host.querySelectorAll('button')].find((element) => element.textContent === text) as HTMLButtonElement

beforeEach(() => {
  apiMocks.saveComments.mockImplementation(async (_id: string, comments: unknown[]) => ({ data: { count: comments.length } }))
})
afterEach(() => {
  act(() => { mounted.forEach((root) => root.unmount()); mounted = [] })
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

it('上限はサーバーと同じ 200 件', () => {
  expect(WEBINAR_SAKURA_COMMENTS_MAX).toBe(200)
})

it('上限を超えた保存は送らず、何件までかといまの件数を出す', async () => {
  apiMocks.comments.mockResolvedValue({ data: rows(201) })
  await render()
  await act(async () => { button('保存する').click() })
  expect(apiMocks.saveComments).not.toHaveBeenCalled()
  expect(host.textContent).toContain('コメントは200 件までです（いま201 件）。減らしてから保存してください。')
})

it('ちょうど上限の件数は保存できる', async () => {
  apiMocks.comments.mockResolvedValue({ data: rows(200) })
  await render()
  await act(async () => { button('保存する').click() })
  expect(apiMocks.saveComments).toHaveBeenCalledTimes(1)
  expect(apiMocks.saveComments.mock.calls[0][1]).toHaveLength(200)
})

it('まとめて貼り付けるときは上限を案内し、超えた JSON は読み込まない', async () => {
  apiMocks.comments.mockResolvedValue({ data: rows(1) })
  await render()
  await act(async () => { button('まとめて貼り付ける（JSON）').click() })
  expect(host.textContent).toContain('（200 件まで）')
  const area = host.querySelector('textarea[aria-label="貼り付けるJSON"]') as HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(area, JSON.stringify(rows(201)))
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { button('読み込む').click() })
  expect(host.textContent).toContain('コメントは200 件までです')
  expect((host.querySelector('input[aria-label="1 行目の名前"]') as HTMLInputElement).value).toBe('名前0')
  expect(host.querySelector('input[aria-label="2 行目の名前"]')).toBeNull()
})
