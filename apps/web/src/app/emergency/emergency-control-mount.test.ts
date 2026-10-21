// @vitest-environment happy-dom
// 現役の画面と共通Dialogを実際に操作して、旧9ケースのAPI・権限・競合を守る。
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { LineAccount } from '@line-crm/shared'
import type { OperationControl, OperationImpactPreview } from '@/lib/api'
import EmergencyScreen from '@/v8/settings/emergency/screen'
import EmergencyControlV8 from '../../v8/emergency/control'
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), useSearchParams: () => new URLSearchParams('tab=control'), usePathname: () => '/emergency' }))
vi.mock('@/contexts/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-a' }) }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner', useStaffIdentity: () => ({ role: 'owner', readOnly: false }) }))
vi.mock('@/components/shared/entity-select', () => import('@/test-utils/entity-select-mock'))
type PreviewPayload = {
  control: OperationControl
  counts: Record<string, number>
  impact: OperationImpactPreview
  permissions: { canControl: boolean; reasonCode?: string | null }
  calculatedAt: string
}

type PreviewResponse = { success: true; data: PreviewPayload }

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const bench = vi.hoisted(() => {
  const previewCalls: Array<{ accountId: string | null; deferred: Deferred<unknown> }> = []
  const stopCalls: Array<{ lineAccountId: string | null; expectedVersion: number }> = []
  const restoreCalls: Array<{ incidentId: string }> = []
  const stepUpCalls: string[] = []
  return {
    previewCalls,
    stopCalls,
    restoreCalls,
    stepUpCalls,
    stopResult: null as null | (() => Promise<unknown>),
    restoreResult: null as null | (() => Promise<unknown>),
  }
})

vi.mock('next/link', async () => {
  const react = await import('react')
  return {
    default: (props: { href: string; children?: unknown; className?: string }) =>
      react.createElement('a', { href: String(props.href), className: props.className }, props.children as never),
  }
})

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは選んだ後の緊急操作の判断なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', async () => {
  const react = await import('react')
  return {
    default: ({ 'aria-label': label, id, value, onChange, options, disabled }: {
      'aria-label'?: string
      disabled?: boolean
      id?: string
      value: string
      onChange: (value: string) => void
      options: Array<{ value: string; label: string }>
    }) => react.createElement(
      'select',
      { 'aria-label': label, id, value, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
      options.map((option) => react.createElement('option', { key: option.value, value: option.value }, option.label)),
    ),
  }
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { role: 'owner' } }) },
      health: { ...actual.api.health, accounts: async () => ({ success: true, data: ACCOUNTS }) },
      operations: {
        ...actual.api.operations,
        history: async () => ({ success: true, data: [] }),
        restorePreview: async () => ({ success: false, error: 'unavailable' }),
        sendPaths: async () => ({ success: false, error: 'unavailable' }),
        preview: (accountId: string | null) => {
          const call = { accountId, deferred: deferred<unknown>() }
          bench.previewCalls.push(call)
          return call.deferred.promise as Promise<never>
        },
        stepUp: (code: string) => {
          bench.stepUpCalls.push(code)
          return Promise.resolve({
            success: true as const,
            data: { token: 'step-up-token', purpose: 'operations.control' as const, expiresAt: '2026-09-09T00:05:00.000Z' },
          }) as Promise<never>
        },
        stop: (input: { lineAccountId: string | null; expectedVersion: number }) => {
          bench.stopCalls.push({ lineAccountId: input.lineAccountId, expectedVersion: input.expectedVersion })
          return (bench.stopResult?.() ?? Promise.reject(new Error('stop は用意されていません'))) as Promise<never>
        },
        restore: (incidentId: string) => {
          bench.restoreCalls.push({ incidentId })
          return (bench.restoreResult?.() ?? Promise.reject(new Error('restore は用意されていません'))) as Promise<never>
        },
      },
    },
  }
})


async function settle(work?: () => void) {
  await act(async () => { work?.(); await new Promise((resolve) => setTimeout(resolve, 0)) })
}
async function mountControl() {
  render(createElement(EmergencyScreen, {
    renderControl: (accounts, ref) => createElement(EmergencyControlV8, { accounts, ref }),
  }))
  await waitFor(() => expect(bench.previewCalls).toHaveLength(1))
}
function impactTitles(mark: number) {
  return screen.queryAllByTitle(new RegExp(`${mark}件`))
}
async function closed() {
  await waitFor(() => expect([...screen.queryAllByRole('dialog'), ...screen.queryAllByRole('alertdialog')]).toHaveLength(0))
}
function feedback() { return document.querySelector('[role="alert"]')?.textContent ?? '' }
async function fillStop() {
  fireEvent.click(screen.getByRole('button', { name: '緊急停止する' }))
  const dialog = await screen.findByRole('alertdialog', { name: '緊急停止を確認' })
  fireEvent.change(within(dialog).getByRole('textbox', { name: '止める理由' }), { target: { value: '宛先の確認' } })
  fireEvent.change(within(dialog).getByRole('textbox', { name: '確認の言葉' }), { target: { value: '停止' } })
  fireEvent.paste(within(dialog).getByRole('textbox', { name: '1桁目' }), { clipboardData: { getData: () => '123456' } })
  return dialog
}
async function runStopFlow() {
  const dialog = await fillStop()
  fireEvent.click(within(dialog).getByRole('button', { name: '緊急停止する' }))
  await closed()
}
async function runRestoreFlow() {
  fireEvent.click(screen.getByRole('button', { name: '復旧する' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox', { name: '確認の言葉' }), { target: { value: '復旧' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '復旧を実行する' }))
  const stepUp = await screen.findByRole('dialog', { name: '認証アプリで本人確認' })
  fireEvent.paste(within(stepUp).getByRole('textbox', { name: '1桁目' }), { clipboardData: { getData: () => '123456' } })
  await closed()
}
async function conflict() {
  const { ApiError } = await import('@/lib/api')
  bench.stopResult = () => Promise.reject(new ApiError(409, '別の管理者が先に変更しました。最新の状態を読み直してください。', 'VERSION_CONFLICT'))
  await runStopFlow()
}
function reloadButton() { return screen.getAllByRole('button', { name: '最新の状態を読み直す' })[0] }
function assertLocked() {
  expect((screen.getByRole('combobox', { name: '緊急停止の対象アカウント' }) as HTMLSelectElement).disabled).toBe(true)
  for (const box of screen.queryAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByRole('textbox', { name: '確認の言葉' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: '1桁目' })).toBeNull()
}
beforeEach(() => {
  bench.previewCalls.length = 0; bench.stopCalls.length = 0; bench.restoreCalls.length = 0; bench.stepUpCalls.length = 0
  bench.stopResult = null; bench.restoreResult = null
})
afterEach(cleanup)
const ACCOUNTS = [
  { id: 'acc-a', name: 'Aアカウント' },
  { id: 'acc-b', name: 'Bアカウント' },
] as unknown as LineAccount[]

function previewPayload(options: {
  mark: number
  accountId?: string | null
  canControl?: boolean
  reasonCode?: string | null
  version?: number
  activeIncidentId?: string | null
}): PreviewPayload {
  const { mark, accountId = null, canControl = true, reasonCode = null, version = 3, activeIncidentId = null } = options
  const metric = (itemCount: number) => ({ itemCount, friendCount: itemCount * 2, pendingCount: 0 })
  return {
    control: {
      scopeKey: accountId ?? 'all',
      lineAccountId: accountId,
      version,
      states: {
        broadcast_dispatch: 'running',
        scenario_dispatch: 'running',
        reminder_dispatch: 'running',
        automation_actions: 'running',
        auto_reply_dispatch: 'running',
        webhook_outgoing: 'running',
        ad_postback: 'running',
      },
      activeIncidentId,
      reason: null,
      actorId: null,
      stoppedAt: null,
      updatedAt: '2026-09-09T00:00:00.000Z',
    },
    counts: {},
    impact: {
      broadcast_dispatch: metric(mark),
      scenario_dispatch: metric(mark + 1),
      reminder_dispatch: metric(mark + 2),
      automation_actions: metric(mark + 3),
      auto_reply_dispatch: metric(mark + 4),
    },
    permissions: { canControl, reasonCode },
    calculatedAt: '2026-09-09T00:00:00.000Z',
  }
}

async function answerPreview(index: number, payload: PreviewPayload) {
  const call = bench.previewCalls[index]
  if (!call) throw new Error(`preview の ${index} 回目が呼ばれていません`)
  await settle(() => call.deferred.resolve({ success: true, data: payload } satisfies PreviewResponse))
}

async function failPreview(index: number, error: unknown) {
  const call = bench.previewCalls[index]
  if (!call) throw new Error(`preview の ${index} 回目が呼ばれていません`)
  await settle(() => call.deferred.reject(error))
}


describe('EmergencyControlV8 を現役の画面から操作する', () => {
  it('Aの遅い応答は、Bへ切り替えたあとの画面を上書きしない（account境界と権限）', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 900 }))
    fireEvent.change(screen.getByRole('combobox', { name: '緊急停止の対象アカウント' }), { target: { value: 'acc-a' } }); await settle()
    fireEvent.change(screen.getByRole('combobox', { name: '緊急停止の対象アカウント' }), { target: { value: 'acc-b' } }); await settle()
    const forA = bench.previewCalls.findIndex((call) => call.accountId === 'acc-a')
    const forB = bench.previewCalls.findIndex((call) => call.accountId === 'acc-b')
    expect(forA).toBeGreaterThanOrEqual(0); expect(forB).toBeGreaterThan(forA)
    await answerPreview(forB, previewPayload({ mark: 222, accountId: 'acc-b', canControl: false, reasonCode: 'EMERGENCY_SCOPE_FORBIDDEN' }))
    await answerPreview(forA, previewPayload({ mark: 111, accountId: 'acc-a', canControl: true }))
    expect(impactTitles(222).length).toBeGreaterThan(0); expect(impactTitles(111)).toHaveLength(0)
    expect(screen.getByRole('combobox', { name: '緊急停止の対象アカウント' }).textContent).toContain('Bアカウント')
    expect(screen.getAllByText(/この範囲を操作する権限がありません/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '緊急停止する' }))
    expect([...screen.queryAllByRole('dialog'), ...screen.queryAllByRole('alertdialog')]).toHaveLength(0); expect(bench.stopCalls).toHaveLength(0)
  })

  it('停止の補足は1000文字まで入力でき、残り字数を実画面で更新する', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 400 }))
    const dialog = await fillStop()
    const detail = within(dialog).getByRole('textbox', { name: /補足/ }) as HTMLTextAreaElement
    expect(detail.maxLength).toBe(1000)
    expect(dialog.textContent).toContain('あと1000文字')
    fireEvent.change(detail, { target: { value: '追加の補足' } })
    expect(dialog.textContent).toContain('あと995文字')
  })

  it('停止の403は、本人確認の窓を閉じて理由を前面に出し、送り直せなくする', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 400 }))
    const { ApiError } = await import('@/lib/api')
    bench.stopResult = () => Promise.reject(new ApiError(403, 'forbidden', 'EMERGENCY_CONTROL_FORBIDDEN'))
    const dialog = await fillStop()
    expect(dialog.textContent).toContain('本人確認（認証アプリの6桁）'); expect(dialog.textContent).not.toContain('止めるとどうなるか')
    fireEvent.click(within(dialog).getByRole('button', { name: '緊急停止する' })); await closed()
    expect(feedback()).toContain('緊急停止を実行する権限がありません。オーナーに権限付与を依頼してください。')
    expect(screen.queryByRole('textbox', { name: '1桁目' })).toBeNull(); expect(screen.queryByRole('textbox', { name: '確認の言葉' })).toBeNull()
    expect(screen.queryByRole('button', { name: '最新の状態を読み直す' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '緊急停止する' }))
    expect([...screen.queryAllByRole('dialog'), ...screen.queryAllByRole('alertdialog')]).toHaveLength(0); expect(bench.stopCalls).toHaveLength(1); expect(bench.stepUpCalls).toHaveLength(1)
  })

  it('復旧の403も同じく窓を閉じ、範囲の理由を前面に出して送り直せなくする', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 700, activeIncidentId: 'incident-9' }))
    const { ApiError } = await import('@/lib/api')
    bench.restoreResult = () => Promise.reject(new ApiError(403, 'forbidden', 'EMERGENCY_SCOPE_FORBIDDEN'))
    await runRestoreFlow()
    expect(feedback()).toContain('この範囲を操作する権限がありません。対象アカウントを選び直すか、オーナーに確認してください。')
    expect(screen.queryByRole('button', { name: '本人確認して実行' })).toBeNull()
    expect(screen.queryByRole('button', { name: '復旧する' })).toBeNull()
    expect(bench.restoreCalls).toHaveLength(1); expect(bench.stepUpCalls).toHaveLength(1)
  })

  it('409はモーダルを閉じ、古い確認内容を捨て、すべての変更操作を止める', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 }))
    expect(impactTitles(111).length).toBeGreaterThan(0); await conflict()
    expect(feedback()).toContain('別の管理者が先に変更しました'); expect(impactTitles(111)).toHaveLength(0)
    expect(reloadButton()).toBeTruthy(); assertLocked()
    const previews = bench.previewCalls.length
    fireEvent.click(screen.getByRole('button', { name: '緊急停止する' }))
    expect([...screen.queryAllByRole('dialog'), ...screen.queryAllByRole('alertdialog')]).toHaveLength(0); expect(bench.previewCalls).toHaveLength(previews)
    expect(bench.stopCalls).toHaveLength(1); expect(bench.stepUpCalls).toHaveLength(1); expect(bench.restoreCalls).toHaveLength(0)
  })

  it('再読込が成功すればlockを解き、最新の内容で確認をやり直せる', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 })); await conflict()
    const index = bench.previewCalls.length
    fireEvent.click(reloadButton()); await settle(); assertLocked(); expect(bench.previewCalls).toHaveLength(index + 1)
    await answerPreview(index, previewPayload({ mark: 333, version: 9 }))
    expect(screen.getByText(/最新の状態を読み直しました/)).toBeTruthy(); expect(impactTitles(333).length).toBeGreaterThan(0); expect(impactTitles(111)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '最新の状態を読み直す' })).toBeNull()
    expect((screen.getByRole('combobox', { name: '緊急停止の対象アカウント' }) as HTMLSelectElement).disabled).toBe(false)
    bench.stopResult = async () => ({ success: true, data: { status: 'changed', control: previewPayload({ mark: 333, version: 10, activeIncidentId: 'incident-1' }).control, incident: { id: 'incident-1' } } })
    const dialog = await fillStop(); expect(dialog.textContent).toContain('333件'); expect(dialog.textContent).not.toContain('111件')
    fireEvent.click(within(dialog).getByRole('button', { name: '緊急停止する' })); await closed()
    expect(bench.stopCalls).toHaveLength(2); expect(bench.stopCalls[1].expectedVersion).toBe(9)
    expect(screen.getByText(/サーバー共通の停止状態を更新しました/)).toBeTruthy()
  })

  it('再読込に失敗しても古い確認内容は戻さず、読み直しの導線を残す', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 })); await conflict()
    const index = bench.previewCalls.length; fireEvent.click(reloadButton()); await settle(); await failPreview(index, new Error('network down'))
    expect(feedback()).toContain('最新の状態を読み直せませんでした'); expect(impactTitles(111)).toHaveLength(0)
    expect(screen.getByText(/停止状態を確認できないため、停止・復旧を実行できません/)).toBeTruthy(); expect(reloadButton()).toBeTruthy(); assertLocked()
    fireEvent.click(screen.getByRole('button', { name: '緊急停止する' })); expect([...screen.queryAllByRole('dialog'), ...screen.queryAllByRole('alertdialog')]).toHaveLength(0); expect(bench.stopCalls).toHaveLength(1)
  })

  it('失敗のあとに読み直せば、最新の内容だけを出してlockを解く', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 })); await conflict()
    const first = bench.previewCalls.length; fireEvent.click(reloadButton()); await settle(); await failPreview(first, new Error('network down'))
    const second = bench.previewCalls.length; fireEvent.click(reloadButton()); await settle(); await answerPreview(second, previewPayload({ mark: 555 }))
    expect(screen.getByText(/最新の状態を読み直しました/)).toBeTruthy(); expect(impactTitles(555).length).toBeGreaterThan(0); expect(impactTitles(111)).toHaveLength(0)
    expect(screen.queryByText(/停止状態を確認できないため/)).toBeNull()
    expect((screen.getByRole('combobox', { name: '緊急停止の対象アカウント' }) as HTMLSelectElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '緊急停止する' })); expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('403・409(版競合)以外の失敗(400)は、窓の裏に隠れず理由が見え、押し直せる', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 }))
    const { ApiError } = await import('@/lib/api'); bench.stopResult = () => Promise.reject(new ApiError(400, '認証コードが正しくありません', 'INVALID_TOTP'))
    await runStopFlow(); expect(feedback()).toContain('認証コードが正しくありません'); expect(impactTitles(111).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '最新の状態を読み直す' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '緊急停止する' })); expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(bench.stopCalls).toHaveLength(1); expect(bench.stepUpCalls).toHaveLength(1)
  })

  it('409でもVERSION_CONFLICT以外(IDEMPOTENCY_CONFLICT)は、別の管理者が変更したと偽らない', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 }))
    const { ApiError } = await import('@/lib/api'); bench.stopResult = () => Promise.reject(new ApiError(409, '同じ再実行キーが別の内容で使われています', 'IDEMPOTENCY_CONFLICT'))
    await runStopFlow(); expect(feedback()).toContain('同じ再実行キーが別の内容で使われています'); expect(feedback()).not.toContain('別の管理者が先に変更しました')
    expect(impactTitles(111).length).toBeGreaterThan(0); expect(screen.queryByRole('button', { name: '最新の状態を読み直す' })).toBeNull()
    expect((screen.getByRole('combobox', { name: '緊急停止の対象アカウント' }) as HTMLSelectElement).disabled).toBe(false)
  })

  it('読み直し中の連打は1回だけ取得し、操作は最新の返事まで止める', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 })); await conflict()
    const index = bench.previewCalls.length
    const button = reloadButton()
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button)
    await settle()
    expect(bench.previewCalls).toHaveLength(index + 1)
    assertLocked()
    await answerPreview(index, previewPayload({ mark: 333 }))
    expect((screen.getByRole('combobox', { name: '緊急停止の対象アカウント' }) as HTMLSelectElement).disabled).toBe(false)
  })

  it('停止中の連打と閉じる操作から同じ要求の二重送信を防ぐ', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 }))
    const pending = deferred<unknown>()
    bench.stopResult = () => pending.promise
    const dialog = await fillStop()
    const button = within(dialog).getByRole('button', { name: '緊急停止する' })
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(bench.stopCalls).toHaveLength(1))
    expect(bench.stepUpCalls).toHaveLength(1)
    expect((within(dialog).getByRole('button', { name: '閉じる' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(bench.stopCalls).toHaveLength(1)
    const { ApiError } = await import('@/lib/api')
    await settle(() => pending.reject(new ApiError(400, '入力を確認してください', 'INVALID_INPUT')))
    await closed()
    expect(feedback()).toContain('入力を確認してください')
  })

  it('止める対象の変更を残したまま再読み込みしようとしたら未保存を確認する', async () => {
    await mountControl(); await answerPreview(0, previewPayload({ mark: 111 }))
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'シナリオ' }))
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'シナリオ' }))
    const reset = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reset)
    expect(reset.defaultPrevented).toBe(false)
  })

})
