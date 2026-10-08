// @vitest-environment happy-dom
/*
 * ★V8 B-26（A-2 採用）受信箱の右の欄でその場で直す：本物の右の欄（FriendInfoSidebar）と
 * 共通の知らせ（ToastHost）を描き、口（api）だけを差し替える。
 * - 対応状況：選んだ瞬間に変えて裏で保存（版を送らない＝その項目だけ変える）→［元に戻す］で前の状態を送る
 * - 失敗：画面を戻し、理由と［もう一度試す］
 * - メモの同時編集：版がずれたら読み直し、相手がメモ以外を直しただけなら黙って保存し直す。
 *   メモも直されていたら、あとから直したこちらを残して知らせ、［元に戻す］で相手のメモに戻せる
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
  addTag: vi.fn(),
  removeTag: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data })
  return {
    ...actual,
    api: {
      friends: {
        get: () => ok({
          id: 'friend-0', displayName: 'Kyohei Yamamoto', pictureUrl: null, isFollowing: true, metadata: {},
          realName: '山本 恭平', systemDisplayName: null, refCode: null, firstTrackedLinkName: null,
          createdAt: '2025-08-13T15:00:00.000Z', formSubmissions: [], formSubmissionTotal: 0,
          tags: [{ id: 'tag-a', name: '未契約', color: '#8B938D' }],
        }),
        mileage: () => ok({ summary: { programName: 'm', available: 0, pending: 0 }, history: [] }),
        richMenu: () => ok({ id: null, name: null, isDefault: true }),
        upcoming: () => ok({ nextBooking: null, nextAutoDelivery: null }),
        addTag: mocks.addTag,
        removeTag: mocks.removeTag,
        updateMetadata: vi.fn(),
      },
      friendFields: { forFriend: () => ok({ items: [] }) },
      tags: { list: () => ok([{ id: 'tag-b', name: 'VIP', color: '#8B938D' }]), create: vi.fn() },
      ecCommerce: { orders: () => ok({ orders: [] }) },
      chats: { update: mocks.update, get: mocks.get },
    },
  }
})
vi.mock('@/app/booking/prepay-badge-v8', () => ({ default: () => null }))
/* 選ぶ欄は共通 Select（listbox）。ここで見たいのは選んだ後の保存なので、素の select にする。 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, id, value, onChange, options }: {
    'aria-label'?: string; id?: string; value: string; onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement('select', { 'aria-label': label, id, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label))),
}))

import { ApiError } from '@/lib/api'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import FriendInfoSidebar from './friend-info-sidebar'

let host: HTMLDivElement
let root: Root

async function eventually(check: () => void) {
  let last: unknown
  for (let i = 0; i < 60; i += 1) {
    try { check(); return } catch (error) { last = error }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  }
  throw last
}
const button = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined

async function renderPanel(notes: string | null = '前のメモ') {
  await act(async () => {
    root.render(
      <>
        <FriendInfoSidebar
          friendId="friend-0"
          chatId="friend-0"
          revision={3}
          chatStatus={{ status: 'unread', notes }}
          operators={[{ id: 'op-k', name: 'Kenta' }, { id: 'op-m', name: 'Masato' }]}
          operatorId="op-k"
        />
        <ToastHost />
      </>,
    )
  })
  await eventually(() => { expect(host.textContent).toContain('次の対応') })
}

beforeEach(() => {
  clearToastsForTest()
  Object.values(mocks).forEach((m) => m.mockReset())
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  clearToastsForTest()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

describe('B-26 右の欄でその場で直す', () => {
  it('対応状況は選んだ瞬間に変え、版を送らずその項目だけ保存し、［元に戻す］で前の状態を送る', async () => {
    mocks.update.mockResolvedValue({ success: true, data: { revision: 4 } })
    await renderPanel()
    const select = document.querySelector('select[aria-label="対応状況を変える"]') as HTMLSelectElement
    await act(async () => {
      select.value = 'in_progress'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(select.value).toBe('in_progress')
    await eventually(() => { expect(host.textContent).toContain('対応状況を「対応中」にしました') })
    expect(mocks.update).toHaveBeenCalledWith('friend-0', { status: 'in_progress' })
    await act(async () => { button('元に戻す')!.click() })
    await eventually(() => { expect(mocks.update).toHaveBeenLastCalledWith('friend-0', { status: 'unread' }) })
    expect((document.querySelector('select[aria-label="対応状況を変える"]') as HTMLSelectElement).value).toBe('unread')
  })

  it('担当の保存に失敗したら選ぶ前に戻し、理由と［もう一度試す］を出す', async () => {
    mocks.update.mockRejectedValueOnce(new ApiError(400, '担当者が見つかりません'))
    await renderPanel()
    const select = document.querySelector('select[aria-label="担当者を変える"]') as HTMLSelectElement
    await act(async () => {
      select.value = 'op-m'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await eventually(() => { expect(host.textContent).toContain('担当を変えられませんでした。担当者が見つかりません') })
    expect((document.querySelector('select[aria-label="担当者を変える"]') as HTMLSelectElement).value).toBe('op-k')
    mocks.update.mockResolvedValue({ success: true, data: { revision: 4 } })
    await act(async () => { button('もう一度試す')!.click() })
    await eventually(() => { expect(host.textContent).toContain('担当をMasatoにしました') })
  })

  it('タグは1つずつ外し、［元に戻す］で付け直す（ほかのタグに触らない）', async () => {
    mocks.removeTag.mockResolvedValue({ success: true, data: null })
    mocks.addTag.mockResolvedValue({ success: true, data: null })
    await renderPanel()
    await eventually(() => { expect(document.querySelector('button[aria-label="未契約を外す"]')).toBeTruthy() })
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="未契約を外す"]')!.click() })
    expect(mocks.removeTag).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('『未契約』を外しますか？')
    expect(document.body.textContent).toContain('この友だちからタグを外します。タグそのものは消えません。')
    await act(async () => { button('外す')!.click() })
    await eventually(() => { expect(host.textContent).toContain('タグ「未契約」を外しました') })
    expect(mocks.removeTag).toHaveBeenCalledWith('friend-0', 'tag-a')
    await act(async () => { button('元に戻す')!.click() })
    await eventually(() => { expect(mocks.addTag).toHaveBeenCalledWith('friend-0', 'tag-a') })
  })

  it('タグを外す確認をキャンセルすると、タグも保存先も変えない', async () => {
    await renderPanel()
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="未契約を外す"]')!.click() })
    await act(async () => { button('キャンセル')!.click() })
    expect(mocks.removeTag).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('『未契約』を外しますか？')
    expect(document.querySelector('button[aria-label="未契約を外す"]')).toBeTruthy()
  })

  it('確認中に友だちを切り替えたら確認を閉じ、別の友だちから外さない', async () => {
    await renderPanel()
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="未契約を外す"]')!.click() })
    await act(async () => { root.render(<FriendInfoSidebar friendId="friend-1" chatId="chat-1" />) })
    expect(document.body.textContent).not.toContain('『未契約』を外しますか？')
    expect(mocks.removeTag).not.toHaveBeenCalled()
  })

  it('v7 は今までの札と付け外しの動きを保つ', async () => {
    document.documentElement.dataset.theme = 'v7'
    mocks.removeTag.mockResolvedValue({ success: true, data: null })
    await renderPanel()
    expect(document.querySelector('[role="group"][aria-label="タグ「未契約」"]')).toBeNull()
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="未契約を外す"]')!.click() })
    expect(mocks.removeTag).toHaveBeenCalledWith('friend-0', 'tag-a')
    expect(document.body.textContent).not.toContain('『未契約』を外しますか？')
  })

  describe('メモの同時編集（最後に直した方を残す）', () => {
    const typeMemo = async (text: string) => {
      const area = document.getElementById('inbox-panel-memo') as HTMLTextAreaElement
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        setter.call(area, text)
        area.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }

    it('相手が直したのがメモ以外なら、読み直した版で黙って保存し直す', async () => {
      mocks.update
        .mockRejectedValueOnce(new ApiError(409, 'ほかの担当者が先に更新しました', 'REVISION_CONFLICT'))
        .mockResolvedValueOnce({ success: true, data: { revision: 6 } })
      mocks.get.mockResolvedValue({ success: true, data: { revision: 5, notes: '前のメモ' } })
      await renderPanel()
      await typeMemo('新しいメモ')
      await eventually(() => { expect(host.textContent).toContain('メモを保存しました') }, )
      expect(mocks.update).toHaveBeenNthCalledWith(1, 'friend-0', { notes: '新しいメモ', revision: 3 })
      expect(mocks.update).toHaveBeenNthCalledWith(2, 'friend-0', { notes: '新しいメモ', revision: 5 })
    })

    it('相手もメモを直していたら、あとから直したこちらを残して知らせ、［元に戻す］で相手のメモに戻す', async () => {
      mocks.update
        .mockRejectedValueOnce(new ApiError(409, 'ほかの担当者が先に更新しました', 'REVISION_CONFLICT'))
        .mockResolvedValue({ success: true, data: { revision: 6 } })
      mocks.get.mockResolvedValue({ success: true, data: { revision: 5, notes: '相手のメモ' } })
      await renderPanel()
      await typeMemo('自分のメモ')
      await eventually(() => { expect(host.textContent).toContain('ほかの人が先にメモを直していました') })
      await act(async () => { button('元に戻す')!.click() })
      await eventually(() => { expect(mocks.update).toHaveBeenLastCalledWith('friend-0', { notes: '相手のメモ' }) })
      expect((document.getElementById('inbox-panel-memo') as HTMLTextAreaElement).value).toBe('相手のメモ')
    })
  })
})
