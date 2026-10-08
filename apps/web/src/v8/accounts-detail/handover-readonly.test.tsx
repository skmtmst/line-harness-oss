// @vitest-environment happy-dom
/*
 * ★V8-B LINEアカウントの乗り換え（板 `x2dSNv`）。
 * v7 と同じ口・同じ守りで、未判断が残る間は本実行を押せず、
 * 判断の保存・本人確認の小窓が動くこと。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const lineAccountsGet = vi.hoisted(() => vi.fn())
const lineAccountsList = vi.hoisted(() => vi.fn())
const staffMe = vi.hoisted(() => vi.fn())
const handoversListForAccount = vi.hoisted(() => vi.fn())
const handoversGet = vi.hoisted(() => vi.fn())
const handoversSaveDecisions = vi.hoisted(() => vi.fn())
const handoversExecute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
      lineAccounts: { ...actual.api.lineAccounts, get: lineAccountsGet, list: lineAccountsList },
      accountHandovers: {
        ...actual.api.accountHandovers,
        listForAccount: handoversListForAccount,
        get: handoversGet,
        saveDecisions: handoversSaveDecisions,
        execute: handoversExecute,
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=acc-1'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('@/components/step-up-prompt', () => ({
  useStepUpGate: () => ({ gate: async () => 'token', prompt: null }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
import HandoverV8 from './handover'


function handoverDetail(over: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    status: 'previewed',
    code: 'ABC123',
    fromAccountId: 'acc-1',
    toAccountId: 'acc-2',
    providerMatch: 'same',
    counts: { sourceTotal: 14, auto: 10, review: 2, unmatched: 1, lookalike: 1 },
    decisions: [
      {
        id: 'd1',
        from_friend_id: 'f1',
        to_friend_id: 'f2',
        decision: 'link',
        bucket: 'review',
        note: null,
        sourceName: '高橋 直人',
        candidateName: '高橋 なおと',
        evidenceLabel: '電話番号が同じ',
      },
      {
        id: 'd2',
        from_friend_id: 'f3',
        to_friend_id: null,
        decision: 'new',
        bucket: 'review',
        note: null,
        sourceName: '森 涼太',
        candidateName: null,
        evidenceLabel: '候補なし',
      },
    ],
    unresolvedReviews: 2,
    declaredFriendTotal: null,
    rolledBackAt: null,
    rollbackDeadline: null,
    rollbackNote: null,
    linkedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  lineAccountsGet.mockReset()
  lineAccountsList.mockReset()
  staffMe.mockReset()
  handoversListForAccount.mockReset()
  handoversGet.mockReset()
  handoversSaveDecisions.mockReset()
  handoversExecute.mockReset()
  lineAccountsGet.mockResolvedValue({ success: true, data: { id: 'acc-1', name: '然-NEN-TEST' } })
  lineAccountsList.mockResolvedValue({ success: true, data: [{ id: 'acc-2', name: '然-NEN-本店' }] })
  staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
  handoversListForAccount.mockResolvedValue({ success: true, data: [{ id: 'h1' }] })
  handoversGet.mockResolvedValue({ success: true, data: handoverDetail() })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
})

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderV8() {
  await act(async () => { root.render(<HandoverV8 />) })
  await flush()
}


it('WEB-136: 役割の確認待ちに乗り換えの実行・取消・判断の変更を出さない', async () => {
  staffMe.mockReturnValue(new Promise(() => {}))
  await renderV8()
  const buttons = [...document.querySelectorAll('button')].map((el) => el.textContent ?? '')
  expect(buttons.some((name) => name.includes('本実行する'))).toBe(false)
  expect(buttons.some((name) => name.includes('引き継ぎをやめる'))).toBe(false)
  expect(buttons.some((name) => name.includes('申告の数を入れる'))).toBe(false)
  expect(document.body.textContent).toContain('要確認')
 })
it('WEB-136: 閲覧のみは友だちの判断を読めるが変更できない', async () => {
  staffMe.mockResolvedValue({ success: true, data: { role: 'staff' } })
  await renderV8()
  expect(document.body.textContent).toContain('要確認')
  expect(document.body.textContent).toContain('閲覧')
  const buttons = [...document.querySelectorAll('button')].map((el) => el.textContent ?? '')
  expect(buttons.some((name) => name.includes('本実行する'))).toBe(false)
  expect(buttons.some((name) => name.includes('引き継ぎをやめる'))).toBe(false)
 })
