// @vitest-environment happy-dom
import React, { act } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReminderRegistrantsPanel } from './registrants-panel'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  updateTargetDate: vi.fn(),
  cancel: vi.fn(),
  resume: vi.fn(),
}))

vi.mock('next/link', () => ({ default: ({ children }: { children: unknown }) => <>{children}</> }))
const account = vi.hoisted(() => ({ selectedAccountId: 'account-a' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: account.selectedAccountId }) }))
vi.mock('@/lib/api', () => ({
  api: { reminders: {
    get: apiMock.get,
    registrants: {
      list: apiMock.list,
      updateTargetDate: apiMock.updateTargetDate,
      cancel: apiMock.cancel,
      resume: apiMock.resume,
    },
  } },
}))

const registrant = {
  id: 'registration-1', friendId: 'friend-1', friendName: '田中 花子', targetDate: '2026-10-01T00:00:00.000Z',
  status: 'active', reminderVersionId: 'snapshot-1', sourceKind: 'manual', createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z', cancelledAt: null, lockVersion: 4,
}
const detailSource = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const listSource = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  account.selectedAccountId = 'account-a'
  apiMock.list.mockResolvedValue({ success: true, data: [registrant] })
  apiMock.updateTargetDate.mockResolvedValue({ success: true, data: { id: registrant.id, friendId: registrant.friendId, targetDate: '2026-10-08T00:00:00.000Z', status: 'active', reminderVersionId: 'snapshot-1', lockVersion: 5, replayed: false } })
  apiMock.cancel.mockResolvedValue({ success: true, data: { id: registrant.id, friendId: registrant.friendId, targetDate: registrant.targetDate, status: 'cancelled', reminderVersionId: 'snapshot-1', lockVersion: 5, replayed: false } })
  apiMock.resume.mockResolvedValue({ success: true, data: { id: registrant.id, friendId: registrant.friendId, targetDate: registrant.targetDate, status: 'active', reminderVersionId: 'snapshot-1', lockVersion: 6, replayed: false } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.clearAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<ReminderRegistrantsPanel reminderId="reminder-1" />)
    await Promise.resolve()
    await Promise.resolve()
  })
}
async function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === label)
  if (!button) throw new Error(`${label} が見つかりません`)
  await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve() })
}

describe('リマインダ詳細の登録者管理 (#868)', () => {
  it('正本URLはstatic exportで再読込できるdetail?idに統一し、動的URLを作らない', () => {
    expect(detailSource).toContain('`/reminders/detail?id=${encodeURIComponent(reminderId)}`')
    expect(listSource).toContain('`/reminders/detail?id=${encodeURIComponent(reminder.id)}`')
    expect(detailSource).not.toContain('`/reminders/${encodeURIComponent(reminderId)}`')
    expect(listSource).not.toContain('`/reminders/${encodeURIComponent(reminder.id)}`')
  })

  it('直URLの登録者一覧から基準日を保存し、リマインダID・版番号を実APIへ渡す', async () => {
    await render()
    expect(host.textContent).toContain('田中 花子')
    const input = host.querySelector('input[aria-label="田中 花子の基準日"]') as HTMLInputElement
    expect(input).not.toBeNull()
    await act(async () => {
      // React の controlled input として値を入れる。直接代入だけでは
      // happy-dom 側の value tracker が変化を通知しない。
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '2026-10-08T09:00')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click('基準日を保存')
    expect(apiMock.updateTargetDate).toHaveBeenCalledWith('reminder-1', 'registration-1', expect.stringMatching(/^2026-10-08T/), 4)
    expect(host.textContent).toContain('未送信分だけ新しい日程で組み直します。')
  })

  it('取消後は再開だけを表示し、再開には取消後の版番号を渡す', async () => {
    await render()
    await click('取消')
    expect(apiMock.cancel).toHaveBeenCalledWith('reminder-1', 'registration-1', 4)
    expect(host.textContent).toContain('取消済み')
    await click('再開')
    expect(apiMock.resume).toHaveBeenCalledWith('reminder-1', 'registration-1', 5)
    expect(host.textContent).toContain('未送信分だけを次の配信処理で組み直します。')
  })

  it('登録者0件と読込失敗を区別して表示する', async () => {
    apiMock.list.mockResolvedValueOnce({ success: true, data: [] })
    await render()
    expect(host.textContent).toContain('登録者はいません')
    await act(async () => { root.unmount() })
    host.replaceChildren()
    root = createRoot(host)
    apiMock.list.mockResolvedValueOnce({ success: false, error: 'not found' })
    await render()
    expect(host.textContent).toContain('登録者を表示できませんでした')
  })

  it('アカウント切替では前の登録者を残さず、対象を読み直す', async () => {
    apiMock.list.mockResolvedValueOnce({ success: true, data: [registrant] }).mockResolvedValueOnce({ success: true, data: [] })
    await render()
    expect(host.textContent).toContain('田中 花子')
    account.selectedAccountId = 'account-b'
    await act(async () => {
      root.render(<ReminderRegistrantsPanel reminderId="reminder-1" />)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(apiMock.list).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('登録者はいません')
    expect(host.textContent).not.toContain('田中 花子')
  })

  it('端末がJST以外でも、UTCの基準日をJSTで表示し同じ瞬間を保存する', async () => {
    const jstRegistrant = { ...registrant, targetDate: '2026-09-16T01:00:00.000Z' }
    apiMock.list.mockResolvedValueOnce({ success: true, data: [jstRegistrant] })
    await render()
    const input = host.querySelector('input[aria-label="田中 花子の基準日"]') as HTMLInputElement
    // 実行端末はUTC+7でも、01:00ZはJST 10:00として画面に出す。
    expect(input.value).toBe('2026-09-16T10:00')
    await click('基準日を保存')
    expect(apiMock.updateTargetDate).toHaveBeenCalledWith('reminder-1', 'registration-1', '2026-09-16T01:00:00.000Z', 4)
  })
})
