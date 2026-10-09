// @vitest-environment happy-dom
/*
 * ★V8-B 案件を作る（Td4TN）。閲覧のみ（owner・admin 以外）には保存のボタンを置かずに帯を出す
 * （2026-10-06 オーナー決定）。成果地点の欄は口が無いので押せない形で置く（F-23 待ち）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }), useSearchParams: () => new URLSearchParams('') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: { id: 'acc-1', name: '然-NEN-TEST' }, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      tags: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
      staff: { me: async () => ({ success: true, data: { role: state.role } }) },
    },
  }
})

import AffiliateOfferCreateV8 from './create'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); state.role = 'owner' })

async function render() {
  await act(async () => { root.render(<AffiliateOfferCreateV8 />) })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const buttons = () => Array.from(host.querySelectorAll('button')).map((b) => b.textContent?.trim())

describe('案件を作る（Td4TN）', () => {
  test('管理者には保存の2つを出し、成果地点は押せない形で置く', async () => {
    await render()
    expect(host.querySelector('[data-design-node="Td4TN"]')).not.toBeNull()
    expect(buttons()).toContain('保存して続けて作る')
    expect(buttons()).toContain('保存して公開')
    expect(host.querySelector<HTMLButtonElement>('#of-point')?.disabled).toBe(true)
    expect(host.textContent).not.toContain('閲覧のみで見ています')
  })

  test('閲覧のみには保存のボタンを置かず、帯を出す', async () => {
    state.role = 'staff'
    await render()
    expect(buttons()).not.toContain('保存して続けて作る')
    expect(buttons()).not.toContain('保存して公開')
    expect(host.textContent).toContain('閲覧のみで見ています')
  })

  test('B-139：案件名と報酬が足りないまま保存すると、欄が赤くなり真下に理由が出て、案件名の欄へ移る', async () => {
    await render()
    const save = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === '保存して公開')!
    await act(async () => { save.click() })
    for (let i = 0; i < 2; i++) await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
    const name = host.querySelector('#of-name') as HTMLInputElement
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector('#of-name-error')?.textContent).toBe('案件名を入力してください')
    expect(host.querySelector('#of-amount')?.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector('#of-amount-error')?.textContent).toBe('報酬（円かマイル）のどちらかを入れてください')
    expect(document.activeElement).toBe(name)
    expect(host.querySelector('[data-design-part="validation-summary"]')?.textContent).toContain('2か所直してください：案件名・報酬額（円）')
  })
})
