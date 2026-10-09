// @vitest-environment happy-dom
/**
 * Issue #967 / U049: /auto-replies/edit の手順表示を共通の Stepper に寄せる。
 *
 * 390px でも現在地の追い方がウェビナー作成（/webinars/new）と同じになるよう、
 * 同じ部品・同じ置き場で出す。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import WizardV8 from './wizard-v8'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AutoReplyEditPage from './page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('step=trigger'),
}))
const accountState = vi.hoisted(() => ({ selectedAccountId: 'a', accounts: [] }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => accountState }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/api', () => ({
  api: {
    templates: { list: vi.fn(async () => ({ success: true, data: [] })) },
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    // R527: この試験は変更できる担当者の筋書き（手順表示の意図を保つ）。
    staff: { me: vi.fn(async () => ({ success: true, data: { role: 'owner' } })) },
    autoReplies: {
      create: vi.fn(),
      update: vi.fn(),
      saveDraft: vi.fn(),
      getDraft: vi.fn(),
      get: vi.fn(),
      conflicts: vi.fn(),
      summary: vi.fn(),
    },
  },
}))
vi.mock('@/components/auto-replies/inline-action-list', () => ({
  default: () => null,
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }),
}))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/image-uploader', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('U049: 自動応答編集の手順表示を共通化', () => {
  it('ウェビナー作成と同じ Stepper 部品で5段を出す', async () => {
    await act(async () => { root.render(<AutoReplyEditPage />) })
    await flush()
    const trail = host.querySelector('[data-design="Steps"]')
    expect(trail).not.toBeNull()
    expect(trail!.getAttribute('aria-label')).toBe('自動応答を作る進み方')
    for (const label of ['基本設定', 'どんなときに動くか', '何を返すか', '優先順位', '確認']) {
      expect(trail!.textContent).toContain(label)
    }
  })

  it('いまの段（step=trigger → 2段目）に aria-current="step" が付く', async () => {
    await act(async () => { root.render(<AutoReplyEditPage />) })
    await flush()
    const trail = host.querySelector('[data-design="Steps"]')
    const current = trail!.querySelector('[aria-current="step"]')
    expect(current).not.toBeNull()
    expect(current!.textContent).toContain('どんなときに動くか')
    // 1段目は完了（✓）、3段目以降は未着手
    expect(trail!.textContent).toContain('✓')
  })
})

it('WEB290：曜日の最後の1つは外せず、その欄で理由を伝える', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => { root.render(<WizardV8 />) })
  await flush()
  const days = [...host.querySelectorAll('[aria-label="反応する曜日"] button')]
  expect(days).toHaveLength(7)
  for (const day of days.slice(0, 6)) await act(async () => fireEvent.click(day))
  await act(async () => fireEvent.click(days[6]))
  expect(days[6].getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('反応する曜日を1つ以上選んでください。')).toBeTruthy()
})
