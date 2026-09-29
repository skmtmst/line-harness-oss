// @vitest-environment happy-dom
/*
 * D001: 閲覧だけの担当者には変更系の口（公開の一時停止・通知テスト・
 * 複製）を出さない。対応APIは owner/admin のみ（Worker の requireRole）
 * なので、押してから失敗させるのではなく画面側でそろえる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  get: vi.fn(),
  editor: vi.fn(),
  pause: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=w1'),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [{ id: 'account-a', liffId: null }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      get: fixture.get,
      editor: fixture.editor,
      pause: fixture.pause,
      testNotifications: vi.fn(),
      duplicate: vi.fn(),
    },
  }
})

import PublishedWebinarPage from './page'

/* happy-dom に localStorage は無い。booking 配下と同じ memorystub を置く。 */
const localStorageValues = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
    removeItem: (key: string) => { localStorageValues.delete(key) },
    clear: () => { localStorageValues.clear() },
  },
})

const webinar = {
  id: 'w1', accountId: 'account-a', title: '採用ウェビナー', slug: 'recruit',
  status: 'active', videoPrefix: null, durationSeconds: 600, schedule: [],
  cta: null, createdAt: 'x', updatedAt: 'x',
}

const editor = {
  version: 3,
  viewingCondition: { kind: 'registered', label: '申込者向け' },
  publicPage: { url: null, unavailableReason: null },
  monitoring: {
    notificationFailures: 0, duplicateRegistrations: 0,
    viewSegmentFailures: 0, actionFailures: 0,
  },
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.get.mockReset()
  fixture.editor.mockReset()
  fixture.pause.mockReset()
  fixture.get.mockResolvedValue({ success: true, data: webinar })
  fixture.editor.mockResolvedValue({ success: true, data: editor })
  window.localStorage.removeItem('lh_staff_role')
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  window.localStorage.removeItem('lh_staff_role')
  await act(async () => { root.unmount() })
  host.remove()
})

async function render() {
  await act(async () => { root.render(<PublishedWebinarPage />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const MUTATING_LABELS = ['公開を一時停止', '通知をテスト', 'ウェビナーを複製して作成']

describe('公開完了画面の権限表示（D001）', () => {
  it('閲覧だけの担当者には変更系ボタンを出さず、理由を添える', async () => {
    await render()

    expect(host.textContent).toContain('公開しました')
    for (const label of MUTATING_LABELS) {
      expect(host.textContent, label).not.toContain(label)
    }
    expect(host.textContent).toContain('オーナーか管理者')
    // 見るだけの操作（編集画面への行き来）は残す。
    expect(host.textContent).toContain('ウェビナーを編集')
  })

  it('オーナーには変更系ボタンを全部出す', async () => {
    window.localStorage.setItem('lh_staff_role', 'owner')
    await render()

    for (const label of MUTATING_LABELS) {
      expect(host.textContent, label).toContain(label)
    }
  })

  it('管理者には変更系ボタンを全部出す', async () => {
    window.localStorage.setItem('lh_staff_role', 'admin')
    await render()

    for (const label of MUTATING_LABELS) {
      expect(host.textContent, label).toContain(label)
    }
  })
})
