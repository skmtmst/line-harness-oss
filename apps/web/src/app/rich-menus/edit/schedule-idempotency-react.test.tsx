// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/rich-menus/edit/" }
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RichMenuCreateV8 from '../../../v8/rich-menus/new/create'
import { pickDateTime } from '@/test-utils/rich-menu-editor'
import { SCHEDULE_SAVED_MESSAGE, SCHEDULE_FAILED_MESSAGE } from '../../../v8/rich-menus/edit/schedule-submit'

const net = vi.hoisted(() => ({
  scheduleCalls: [] as Array<{ key: string; input: Record<string, unknown> }>,
  scheduleResult: 'ok' as 'ok' | 'lost' | 'conflict',
  draftWrites: 0,
}))
const account = { id: 'account-1', name: 'テスト店' }
const group = {
  id: 'menu-1', accountId: 'account-1', name: 'キャンペーン', chatBarText: 'メニュー',
  size: 'large', defaultPageId: 'p1', isDefaultForAll: false, status: 'draft',
  targetingCondition: null, targetingPriority: 0, targetingEnabled: false,
  folderId: null, defaultOpen: true, version: 1,
  pages: [{ id: 'p1', orderIndex: 0, name: '1枚目', aliasId: '', lineRichmenuId: null, imageR2Key: 'img', imageContentType: 'image/jpeg', areas: [] }],
}
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccount: account, selectedAccountId: account.id, accounts: [account], loading: false }),
}))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: 'owner-1', role: 'owner' } }) },
      folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
      tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
      templates: { ...actual.api.templates, list: async () => ({ success: true, data: [] }) },
      forms: { ...actual.api.forms, list: async () => ({ success: true, data: [] }) },
      trackedLinks: { ...actual.api.trackedLinks, list: async () => ({ success: true, data: [] }) },
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        get: async () => ({ success: true, data: group }),
        update: async () => { net.draftWrites += 1; return { success: true, data: group } },
        list: async () => ({ success: true, data: [] }),
        previewTargets: async () => ({ success: true, data: null }),
        prepublishCheck: async () => ({ success: true, data: { selfCheck: { ok: true }, deviceConfirmed: true, deviceConfirmedAt: null, pageCount: 1, maxPages: 10 } }),
        validatePublish: async () => ({ success: true, data: { checks: [{ key: 'self', ok: true }, { key: 'line', ok: true }] } }),
        schedule: async (_id: string, input: Record<string, unknown>, key: string) => {
          net.scheduleCalls.push({ key, input })
          if (net.scheduleResult === 'lost') throw new TypeError('Failed to fetch')
          if (net.scheduleResult === 'conflict') return { success: false, error: '同じ内容の予約がすでにあります' }
          return { success: true, data: { id: 'schedule-1', status: 'scheduled' } }
        },
      },
    },
  }
})

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}
async function flush() { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() }) }
async function openEditor() {
  window.history.replaceState(null, '', '/rich-menus/edit?id=menu-1&step=publish')
  await act(async () => { root.render(<RichMenuCreateV8 editGroupId="menu-1" />) })
  await screen.findByRole('heading', { name: 'いつ公開するか' })
}
async function fillScheduleForm(startsAt: string) {
  fireEvent.click(screen.getByRole('radio', { name: /日時を決めて公開する/ }))
  await pickDateTime('公開を始める日時', startsAt)
  fireEvent.click(screen.getAllByRole('button', { name: '見直す' })[1])
  await flush()
}
async function pressReserve() {
  const count = net.scheduleCalls.length
  fireEvent.click(screen.getByRole('button', { name: '予約する' }))
  await waitFor(() => expect(net.scheduleCalls).toHaveLength(count + 1))
  await flush()
}
beforeEach(async () => {
  net.scheduleCalls.length = 0
  net.scheduleResult = 'ok'
  net.draftWrites = 0
  vi.stubGlobal('localStorage', new MemoryStorage())
  document.documentElement.dataset.theme = 'v8'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await openEditor()
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  delete document.documentElement.dataset.theme
  localStorage.clear()
})
describe('現役の公開予約の再試行と冪等鍵', () => {
  it('応答が返らなかった押し直しは同じキーで送り、予約を2件にしない', async () => {
    await fillScheduleForm('2026-09-20T10:00')
    net.scheduleResult = 'lost'
    await pressReserve()
    expect(screen.getByText(SCHEDULE_FAILED_MESSAGE)).toBeTruthy()
    net.scheduleResult = 'ok'
    await pressReserve()
    expect(net.scheduleCalls[1].key).toBe(net.scheduleCalls[0].key)
    expect(net.scheduleCalls[1].input).toEqual(net.scheduleCalls[0].input)
    expect(net.draftWrites).toBe(2)
    expect(screen.getByText(SCHEDULE_SAVED_MESSAGE)).toBeTruthy()
    expect(screen.queryByText(SCHEDULE_FAILED_MESSAGE)).toBeNull()
  })
  it('保存できたあとの予約は新しいキーになる（別の操作として通る）', async () => {
    await fillScheduleForm('2026-09-20T10:00')
    await pressReserve()
    await screen.findByRole('heading', { name: '公開予約を受け付けました' })
    // 保存した編集を閉じて開き直し、新しい予約を作る。
    await act(async () => { root.render(null) })
    await openEditor()
    await fillScheduleForm('2026-09-20T10:00')
    await pressReserve()
    expect(net.scheduleCalls[1].key).not.toBe(net.scheduleCalls[0].key)
  })
  it('サーバーが断ってもキーは変えない（同じ内容の押し直しを2件にしない）', async () => {
    await fillScheduleForm('2026-09-20T10:00')
    net.scheduleResult = 'conflict'
    await pressReserve()
    await pressReserve()
    expect(net.scheduleCalls[1].key).toBe(net.scheduleCalls[0].key)
    expect(screen.getByText(SCHEDULE_FAILED_MESSAGE)).toBeTruthy()
  })
  it('応答が返らないまま中身を直したら、別の操作として新しいキーになる', async () => {
    await fillScheduleForm('2026-09-20T10:00')
    net.scheduleResult = 'lost'
    await pressReserve()
    net.scheduleResult = 'ok'
    await fillScheduleForm('2026-09-21T10:00')
    await pressReserve()
    expect(net.scheduleCalls[1].key).not.toBe(net.scheduleCalls[0].key)
    expect(net.scheduleCalls[1].input.startsAt).not.toBe(net.scheduleCalls[0].input.startsAt)
  })
})
