// @vitest-environment happy-dom
/*
 * #1052 STAFF-02: 操作記録の期間切替で、集計題・件数・タブ集計を
 * 取得成功した期間へそろえる。
 *
 *   - 「この30日」「過去90日」「すべての期間」で題と取得条件(from)が一致する
 *   - 読み込み中は、表示中の集計がどの期間のものかを保ったまま、
 *     切替中であることを補足に出す（旧期間の数を新期間の結果に見せない）
 *   - 取得失敗では前回の期間の集計をそのまま表示し、失敗したことを明記する
 *   - 素早い切替で古い応答が新しい期間の結果を上書きしない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginAudit from './login-audit'

const fixture = vi.hoisted(() => ({
  events: vi.fn(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      audit: { events: fixture.events },
    },
  }
})

type Summary = {
  periodDays: number | null
  total: number
  deleted: number
  sent: number
  changed: number
  logins: number
  suspiciousLogins: number
}

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    periodDays: 30, total: 3, deleted: 0, sent: 0, changed: 0, logins: 3, suspiciousLogins: 0,
    ...overrides,
  }
}

function ok(payload: { summary: Summary; total: number; items?: unknown[] }) {
  return {
    success: true,
    data: {
      items: payload.items ?? [],
      summary: payload.summary,
      pagination: { total: payload.total, limit: 20, offset: 0 },
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  fixture.events.mockReset()
  fixture.events.mockResolvedValue(ok({ summary: summary(), total: 3 }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render() {
  await act(async () => { root.render(<LoginAudit />) })
  await settle()
}

/** 期間の Select を開いて label の選択肢を押す。 */
async function choosePeriod(label: string) {
  const trigger = host.querySelector('button[aria-label="期間で絞り込む"]') as HTMLButtonElement
  expect(trigger).toBeTruthy()
  await act(async () => { trigger.click() })
  const option = [...host.querySelectorAll('ul[role="listbox"] button')]
    .find((button) => button.textContent?.trim().endsWith(label)) as HTMLButtonElement | undefined
  expect(option, `期間の選択肢「${label}」`).toBeTruthy()
  await act(async () => { option!.click() })
}

function lastRequestFrom(): string | undefined {
  return fixture.events.mock.calls.at(-1)?.[0]?.from as string | undefined
}

function daysAgo(value: string): number {
  return (Date.now() - Date.parse(value)) / (24 * 60 * 60 * 1000)
}

describe('操作記録の期間切替と集計題 (STAFF-02)', () => {
  it('期間30日では「この30日の記録」と30日前からの取得条件になる', async () => {
    await render()

    expect(host.textContent).toContain('この30日の記録')
    const from = lastRequestFrom()
    expect(from).toBeTruthy()
    expect(Math.abs(daysAgo(from!) - 30)).toBeLessThan(1)
  })

  it('過去90日へ切り替えると、題・件数・取得条件が90日にそろう', async () => {
    await render()

    fixture.events.mockImplementationOnce(() => Promise.resolve(ok({ summary: summary({ periodDays: 90, total: 7 }), total: 7 })))
    await choosePeriod('過去90日')
    await settle()

    const from = lastRequestFrom()
    expect(from).toBeTruthy()
    expect(Math.abs(daysAgo(from!) - 90)).toBeLessThan(1)
    expect(host.textContent).toContain('過去90日の記録')
    expect(host.textContent).not.toContain('この30日の記録')
    expect(host.textContent).toContain('7件')
  })

  it('すべての期間では from を付けず、題も全期間になる', async () => {
    await render()

    fixture.events.mockImplementationOnce(() => Promise.resolve(ok({ summary: summary({ periodDays: null, total: 41 }), total: 41 })))
    await choosePeriod('すべての期間')
    await settle()

    expect(lastRequestFrom()).toBeUndefined()
    expect(host.textContent).toContain('すべての期間の記録')
    expect(host.textContent).toContain('41件')
  })

  it('読み込み中は旧期間の題と件数のままにし、切替中であることを補足する', async () => {
    await render()

    const pending = deferred<ReturnType<typeof ok>>()
    fixture.events.mockImplementationOnce(() => pending.promise)
    await choosePeriod('過去90日')

    // まだ90日の結果は返っていない。表示中の集計は30日のものと分かる。
    expect(host.textContent).toContain('この30日の記録')
    expect(host.textContent).toContain('過去90日の記録を読み込み中…')

    await act(async () => { pending.resolve(ok({ summary: summary({ periodDays: 90, total: 9 }), total: 9 })) })
    await settle()
    expect(host.textContent).toContain('過去90日の記録')
    expect(host.textContent).toContain('9件')
  })

  it('取得に失敗したら前回の期間の集計のままにし、失敗したことを明記する', async () => {
    await render()

    fixture.events.mockRejectedValueOnce(new Error('database unavailable'))
    await choosePeriod('過去90日')
    await settle()

    expect(host.textContent).toContain('入った記録を読み込めませんでした')
    // 「過去90日 0件」と読み違えないよう、前回（30日）の集計をそのまま示す。
    expect(host.textContent).toContain('この30日の記録')
    expect(host.textContent).toContain('読み込みに失敗したため、前回の集計を表示しています')
    expect(host.textContent).toContain('3件')
  })

  it('素早い切替で、先に投げた古い期間の応答は新しい結果を上書きしない', async () => {
    await render()

    // 90日の応答を遅らせ、その間に30日へ戻す。
    const slow90 = deferred<ReturnType<typeof ok>>()
    fixture.events.mockImplementationOnce(() => slow90.promise)
    await choosePeriod('過去90日')

    fixture.events.mockImplementationOnce(() => Promise.resolve(ok({ summary: summary({ periodDays: 30, total: 5 }), total: 5 })))
    await choosePeriod('この30日')
    await settle()
    expect(host.textContent).toContain('この30日の記録')
    expect(host.textContent).toContain('5件')

    // 遅れて届いた90日の応答は捨てる。題も件数も30日のまま。
    await act(async () => { slow90.resolve(ok({ summary: summary({ periodDays: 90, total: 99 }), total: 99 })) })
    await settle()
    expect(host.textContent).toContain('この30日の記録')
    expect(host.textContent).toContain('5件')
    expect(host.textContent).not.toContain('99件')
    expect(host.textContent).not.toContain('過去90日の記録')
  })
})
