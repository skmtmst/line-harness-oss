// @vitest-environment happy-dom
/*
 * 公開の進み V8（板 hKr8f）。
 * V8 では板IDといまの状態の欄を出す。v7 はそのまま。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        list: async () => ({ success: true, data: [] }),
        listSchedules: async () => ({ success: true, data: [] }),
        publishProgress: async () => ({
          success: true,
          data: { steps: [], message: null, run: { status: 'done' } },
        }),
      },
    },
  }
})
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@line-crm/shared', () => ({ RICH_MENU_DIMENSIONS: { large: { width: 2500, height: 1686 }, compact: { width: 2500, height: 843 } } }))

const { default: RichMenuEditPage } = await import('./page')
const testing = (RichMenuEditPage as unknown as { __testing: { PublishStep: React.ComponentType<Record<string, unknown>> } }).__testing

const group = {
  id: 'g1', accountId: 'account-a', name: '通常メニュー（会員向け）',
  chatBarText: 'メニュー', size: 'large', defaultPageId: null, isDefaultForAll: true,
  status: 'published', publishingAt: null, targetingCondition: null, targetingPriority: 0,
  targetingEnabled: false, folderId: null, version: 1, pages: [],
}

const props = {
  group, pages: [], preview: null, saving: false, publishing: false,
  publish: { mode: 'now', startsAt: '', endsAt: null, restoreGroupId: '' },
  onPublishChange: () => {}, conditionEmpty: false, previewUnsaved: false,
  isDefaultForAll: true, targetingEnabled: false, saveError: null, saveNotice: '',
  onSave: () => {}, onPublishNow: () => {}, onSchedule: async () => {},
  canOperate: true, onChanged: () => {}, submit: () => {}, onSaveDraft: () => {},
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.theme })

async function render() {
  const Step = testing.PublishStep
  await act(async () => { root.render(<Step {...props} />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

describe('公開の進みV8（hKr8f）', () => {
  it('板IDといまの状態を出す', async () => {
    document.documentElement.dataset.theme = 'v8'
    await render()
    expect(host.querySelector('[data-design-node="hKr8f"]')).not.toBeNull()
    expect(host.textContent).toContain('いまの状態')
    expect(host.textContent).toContain('公開中')
    expect(host.textContent).toContain('すべての友だち')
  })

  it('v7はUMiJ9のまま', async () => {
    await render()
    expect(host.querySelector('[data-design-node="UMiJ9"]')).not.toBeNull()
    expect(host.querySelector('[data-design-node="hKr8f"]')).toBeNull()
    expect(host.textContent).not.toContain('いまの状態')
  })
})
