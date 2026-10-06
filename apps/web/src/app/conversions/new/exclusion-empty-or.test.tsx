// @vitest-environment happy-dom
/*
 * S4-OR（利用画面の証明）: 成果地点の作成で、空の or かたまりは
 * 保存時に案内され、黙って「除外なし」にならない。
 * 中身を入れたかたまりは保存できる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import NewConversionPage from './page'

const st = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  created: [] as unknown[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: st.accountId,
    selectedAccount: { id: 'account-a', name: 'A店' },
    accounts: [{ id: 'account-a', name: 'A店' }],
  }),
}))
vi.mock('@/components/layout/header', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number, message?: string) {
      super(message ?? `API error: ${status}`)
      this.status = status
    }
  }
  return {
    ApiError,
    api: {
      conversions: {
        points: async () => ({ success: true, data: [] }),
        previewDefinition: async () => ({ success: false, error: 'preview not available' }),
        createDefinition: async (payload: unknown) => {
          st.created.push(payload)
          return { success: true, data: { id: 'cv-1' } }
        },
      },
      analytics: { v6Funnels: { list: async () => ({ success: true, data: [] }) } },
      automations: { list: async () => ({ success: true, data: [] }) },
      nenCampaigns: { settings: async () => ({ success: true, data: [] }) },
      featureSettings: {
        visibility: async () => ({ success: true, data: { features: {} } }),
      },
      tags: { list: async () => ({ success: true, data: [] }) },
      friendFields: { list: async () => ({ success: true, data: [] }) },
      supportMarks: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
    },
  }
})

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  st.accountId = 'account-a'
  st.created = []
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  cleanup()
})

async function renderPage() {
  await act(async () => root.render(<NewConversionPage />))
}

function setName() {
  const input = host.querySelector('#cv-name') as HTMLInputElement
  expect(input).not.toBeNull()
  fireEvent.change(input, { target: { value: 'テストの成果' } })
}

function addOrGroup() {
  fireEvent.click(screen.getByRole('button', { name: /いずれか1つ以上を満たす.*を追加/ }))
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: '保存して数えはじめる' }))
}

function pickKind(field: HTMLElement, query: string) {
  fireEvent.focus(field)
  fireEvent.change(field, { target: { value: query } })
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  fireEvent.keyDown(field, { key: 'Enter' })
}

describe('S4-OR 成果地点の数えない条件', () => {
  it('空の or かたまりのまま保存すると案内が出て、作られない', async () => {
    await renderPage()
    setName()
    addOrGroup()
    // 空のかたまりが編集表示として残っている（消えていない）。
    expect(screen.getByRole('button', { name: 'このかたまりを外す' })).toBeTruthy()
    await act(async () => {
      save()
    })
    expect(host.textContent).toContain('空の「いずれか」の条件のかたまりがあります')
    expect(st.created).toHaveLength(0)
  })

  it('かたまりに条件を入れると保存でき、除外として送られる', async () => {
    await renderPage()
    setName()
    addOrGroup()
    const fields = screen.getAllByRole('combobox', { name: '追加する条件を選ぶ' })
    expect(fields).toHaveLength(2)
    pickKind(fields[1], '行動スコア')
    await act(async () => {
      save()
    })
    expect(host.textContent).not.toContain('空の「いずれか」の条件のかたまりがあります')
    expect(st.created).toHaveLength(1)
    const payload = st.created[0] as {
      sourceConfig: { exclusion: { groups: { rules: { type: string }[] }[] } | null }
    }
    expect(payload.sourceConfig.exclusion?.groups).toHaveLength(1)
    expect(payload.sourceConfig.exclusion?.groups[0].rules[0].type).toBe('score_range')
  })
})
