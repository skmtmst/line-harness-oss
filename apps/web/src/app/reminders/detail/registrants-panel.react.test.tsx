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

/** 基準日を日時の選択（★V7）で選ぶ。値は今までどおり YYYY-MM-DDTHH:mm（日本時間）。 */
async function pickTargetDate(label: string, iso: string) {
  const [date, time] = iso.split('T')
  const [hour, minute] = time.split(':')
  const [y, mo, d] = date.split('-').map(Number)
  const week = '日月火水木金土'[new Date(y, mo - 1, d).getDay()]
  await act(async () => {
    host.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click()
    await Promise.resolve()
    await Promise.resolve()
  })
  const picker = host.querySelector('[role="dialog"][aria-label="日時を選ぶ"]')!
  await act(async () => {
    picker.querySelector<HTMLButtonElement>('button[aria-label="日付"]')!.click()
    await Promise.resolve()
    await Promise.resolve()
  })
  for (let i = 0; i < 24; i += 1) {
    const grid = host.querySelector('[role="grid"]')
    if (grid?.getAttribute('aria-label') === `${y}年${mo}月`) break
    const currentLabel = /^(\d+)年(\d+)月$/.exec(grid?.getAttribute('aria-label') ?? '')
    const current = currentLabel ? Number(currentLabel[1]) * 12 + Number(currentLabel[2]) : y * 12 + mo
    const nav = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === (y * 12 + mo >= current ? '次の月' : '前の月'),
    )!
    await act(async () => {
      nav.click()
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  await act(async () => {
    [...host.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith(`${y}年${mo}月${d}日（${week}）`),
    )!.click()
    await Promise.resolve()
    await Promise.resolve()
  })
  const reopened = host.querySelector('[role="dialog"][aria-label="日時を選ぶ"]')!
  await act(async () => {
    const hourSelect = reopened.querySelector('select[aria-label="時"]') as HTMLSelectElement
    hourSelect.value = hour
    hourSelect.dispatchEvent(new Event('change', { bubbles: true }))
    const minuteSelect = reopened.querySelector('select[aria-label="分"]') as HTMLSelectElement
    minuteSelect.value = minute
    minuteSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    [...reopened.querySelectorAll('button')].find((b) => b.textContent?.trim() === '閉じる')!.click()
    await Promise.resolve()
    await Promise.resolve()
  })
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
    await pickTargetDate('田中 花子の基準日', '2026-10-08T09:00')
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
    const trigger = host.querySelector('button[aria-label="田中 花子の基準日"]')
    // 実行端末はUTC+7でも、01:00ZはJST 10:00として画面に出す（日本語の見せ方）。
    expect(trigger?.textContent).toContain('2026年9月16日（水）10:00')
    await click('基準日を保存')
    expect(apiMock.updateTargetDate).toHaveBeenCalledWith('reminder-1', 'registration-1', '2026-09-16T01:00:00.000Z', 4)
  })
})

describe('登録者一覧の器（監査A2）', () => {
  it('配列で名前が出る', async () => {
    apiMock.list.mockResolvedValue({
      success: true,
      data: [
        { ...registrant, id: 'reminder-enrollment-1', friendName: '高橋 直人' },
        { ...registrant, id: 'reminder-enrollment-2', friendName: '前田 さくら' },
      ],
    })
    await render()
    expect(host.textContent).toContain('高橋 直人')
    expect(host.textContent).toContain('前田 さくら')
  })

  it('旧偽APIの器（配列でない）では読み込み失敗になる', async () => {
    apiMock.list.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } })
    await render()
    expect(host.textContent).toContain('登録者を読み込めませんでした')
  })
})
