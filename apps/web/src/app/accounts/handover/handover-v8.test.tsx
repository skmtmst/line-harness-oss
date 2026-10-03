// @vitest-environment happy-dom
/*
 * ★V8-B LINEアカウントの乗り換え（板 `x2dSNv`）。
 * v7 と同じ口・同じ守りで、未判断が残る間は本実行を押せず、
 * 判断の保存・本人確認の小窓が動くこと。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
}))

import HandoverV8 from './handover-v8'

const v8css = readFileSync(join(process.cwd(), 'src/app/accounts/handover/handover-v8.module.css'), 'utf8')
const v8tsx = readFileSync(join(process.cwd(), 'src/app/accounts/handover/handover-v8.tsx'), 'utf8')

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

describe('V8-B 乗り換え（x2dSNv）', () => {
  it('手順・判断の表・下の帯が出て、未判断の間は本実行を押せない', async () => {
    await renderV8()
    expect(document.querySelector('[data-design-node="x2dSNv"]'), '板IDの枠がある').toBeTruthy()
    expect(document.body.textContent).toContain('乗り換え（然-NEN-TEST → 然-NEN-本店）')
    expect(document.body.textContent).toContain('要確認')
    const execute = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('本実行する')) as HTMLButtonElement
    expect(execute, '本実行の口がある').toBeTruthy()
    expect(execute.disabled, '未判断2人の間は押せない').toBe(true)
    expect(document.body.textContent).toContain('未判断が 2人残っています')
  })

  it('判断を変えて保存すると保存の口を叩く', async () => {
    handoversSaveDecisions.mockResolvedValue({ success: true, data: {} })
    await renderV8()
    // 1行目の判断を「新しく作る」に変える（共有 Select は小さな窓で選ぶ形）
    const selects = document.querySelectorAll('button[aria-label="この人の判断"]')
    await act(async () => { (selects[0] as HTMLButtonElement).click() })
    await flush()
    const option = [...document.querySelectorAll('[role="option"] button')].find((o) => o.textContent === '新しく作る') as HTMLElement
    await act(async () => { option!.click() })
    await flush()
    expect(document.body.textContent).toContain('1件の書き換えをまだ保存していません')
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === '判断を保存する')
    await act(async () => { save!.click() })
    await flush()
    expect(handoversSaveDecisions, '判断の保存を叩く').toHaveBeenCalled()
  })

  it('V8 の決まり（layer・色直書きなし・準備中なし）を守る', () => {
    expect(v8css.split('\n')[0]).toContain('@layer properties, theme, base, components, utilities;')
    expect(v8css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(v8css).not.toMatch(/box-shadow\s*:/)
    expect(v8tsx).toContain('data-design-node="x2dSNv"')
    expect(v8tsx).not.toContain('準備中')
  })
})
