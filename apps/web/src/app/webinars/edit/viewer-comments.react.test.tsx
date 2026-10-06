// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userComments = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), webinarApi: { userComments } }))
import { ApiError } from '@/lib/api'
import ViewerComments from './viewer-comments'

const COMMENT = { id: 'comment-1', friendId: 'friend 1', friendName: '参加者', pictureUrl: null, sessionStartAt: 1, atSeconds: -30, body: '質問があります\nありがとうございます', createdAt: '' }
let root: Root
let host: HTMLDivElement
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function render(id = 'webinar-1') {
  await act(async () => root.render(<ViewerComments webinarId={id} />))
}

describe('分析の視聴者コメント', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    userComments.mockResolvedValue({ data: [COMMENT] })
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.resetAllMocks()
  })

  it('実際のコメント・開始前の時刻と友だちのチャットへのリンクを戻す', async () => {
    await render()
    expect(userComments).toHaveBeenCalledWith('webinar-1')
    expect(host.textContent).toContain(COMMENT.body)
    expect(host.textContent).toContain('-0:30')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/chats?friend=friend%201')
    expect(host.textContent).toContain('1件')
  })

  it('コメントの失敗はこの欄で再取得できる', async () => {
    userComments.mockRejectedValueOnce(new Error('offline'))
    await render()
    expect(host.textContent).toContain('読み込めませんでした')
    expect(host.textContent).not.toContain('0件')
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === 'もう一度読み込む')!
    await act(async () => retry.click())
    expect(host.textContent).toContain(COMMENT.body)
    expect(userComments).toHaveBeenCalledTimes(2)
  })

  it('権限なしをゼロ件や空のコメントとして表示しない', async () => {
    userComments.mockRejectedValueOnce(new ApiError(403, 'forbidden'))
    await render()
    expect(host.textContent).toContain('権限がありません')
    expect(host.textContent).not.toContain('0件')
    expect(host.textContent).not.toContain('まだコメントはありません')
  })

  it('空の結果は読み込み失敗と区別して表示する', async () => {
    userComments.mockResolvedValueOnce({ data: [] })
    await render()
    expect(host.textContent).toContain('0件')
    expect(host.textContent).toContain('まだコメントはありません')
  })

  it('別のウェビナーへ切り替えた後に古い返答が届いても混ざらない', async () => {
    let resolveOld!: (response: { data: typeof COMMENT[] }) => void
    userComments.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    await render()
    userComments.mockResolvedValueOnce({ data: [{ ...COMMENT, body: '新しいコメント' }] })
    await render('webinar-2')
    await act(async () => resolveOld({ data: [COMMENT] }))
    expect(host.textContent).toContain('新しいコメント')
    expect(host.textContent).not.toContain(COMMENT.body)
  })
})
