// @vitest-environment happy-dom
/**
 * Issue #967 / U049: /auto-replies/edit の手順表示を共通の StepTrail に寄せる。
 *
 * 390px でも現在地の追い方がウェビナー作成（/webinars/new）と同じになるよう、
 * 同じ部品・同じ置き場で出す。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AutoReplyEditPage from './page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('step=trigger'),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/api', () => ({
  api: {
    templates: { list: vi.fn(async () => ({ success: true, data: [] })) },
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
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
  it('ウェビナー作成と同じ StepTrail 部品で5段を出す', async () => {
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
