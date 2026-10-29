// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- lightweight component mocks for interaction coverage */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'

const state = vi.hoisted(() => ({ search: 'step=basic', saved: null as any }))
vi.mock('next/navigation', () => ({ usePathname: () => '/friend-add-settings/new', useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams(state.search) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }) }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/list-state', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock('@/components/shared/select', () => ({ default: ({ value, onChange, options }: any) => <select value={value} onChange={(event: any) => onChange?.(event.target.value)}>{options.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}</select> }))
vi.mock('@/components/shared/sticky-bar', () => ({ default: ({ actions }: any) => <div>{actions}</div> }))
vi.mock('@/components/shared/text-field', () => ({ TextField: (props: any) => <input {...props} />, TextArea: (props: any) => <textarea {...props} /> }))
vi.mock('@/components/shared/date-time-field', async (original) => ({ ...await original<typeof import('@/components/shared/date-time-field')>(), default: ({ value, onChange, ...rest }: any) => <input {...rest} value={value} onChange={(event: any) => onChange?.(event.target.value)} /> }))
vi.mock('@/components/shared/button', () => ({ default: ({ href, children, ...props }: any) => href ? <a href={href}>{children}</a> : <button {...props}>{children}</button> }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { friendAddRules: {
    list: vi.fn(async () => ({ success: true, data: { items: [], options: { routes: [], scenarios: [], tags: [], folders: [] } } })),
    conflicts: vi.fn(async () => ({ success: true, data: { rules: [], conflicts: [] } })),
    createDraft: vi.fn(async (payload: any) => { state.saved = payload; return { success: true, data: { id: 'rule-1', version: 1 } } }),
    saveDraft: vi.fn(), test: vi.fn(), get: vi.fn(),
  } } }
})

const { default: Editor } = await import('@/v8/friend-add/editor')
let host: HTMLDivElement; let root: Root
beforeEach(() => { window.history.replaceState(null, '', '/friend-add-settings?view=new&step=basic'); Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }); state.search = 'step=basic'; state.saved = null; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.restoreAllMocks() })
async function render() { await act(async () => { root.render(<Editor />); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); await Promise.resolve() }) }
function button(label: string, exact = false) { const node = [...document.querySelectorAll('button')].find((item) => !item.disabled && (item.getAttribute('aria-label') === label || (exact ? item.textContent === label : item.textContent?.includes(label)))); if (!node) throw new Error(`${label}: ${document.body.textContent?.slice(0, 500)}`); return node }
/* 窓の下の［閉じる］だけを選ぶ（右上の×は aria-label のみで本文を持たない）。 */
function footerClose() { const node = [...document.querySelectorAll('[data-window-actions] button')].find((item) => !item.disabled && item.textContent?.trim() === '閉じる'); if (!node) throw new Error(`footer-close: ${document.body.textContent?.slice(0, 500)}`); return node as HTMLButtonElement }
async function name(value: string) { const input = host.querySelector('input'); if (!input) throw new Error('name'); await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) }) }
function memoArea() { const area = document.querySelector('#fa-internal-memo') as HTMLTextAreaElement | null; if (!area) throw new Error(`memo: ${document.body.textContent?.slice(0, 500)}`); return area }
async function waitClosed() { for (let i = 0; i < 50 && document.querySelector('#fa-internal-memo'); i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }

describe('社内メモの窓は破棄確認を出さず閉じる', () => {
  it('入力後に［閉じる］で確認なしに閉じ、メモが残る', async () => {
    await render()
    await act(async () => { button('社内メモ').click() })
    await act(async () => { fireEvent.change(memoArea(), { target: { value: '引き継ぎあり' } }) })
    await act(async () => { footerClose().click() })
    expect(document.body.textContent).not.toContain('入力を破棄しますか？')
    await waitClosed()
    expect(document.querySelector('#fa-internal-memo')).toBeNull()
    await act(async () => { button('社内メモ').click() })
    expect(memoArea().value).toBe('引き継ぎあり')
  })
  it('閉じたあと下書き保存にメモが入る', async () => {
    await render()
    await name('秋の案内')
    await act(async () => { button('社内メモ').click() })
    await act(async () => { fireEvent.change(memoArea(), { target: { value: '引き継ぎあり' } }) })
    await act(async () => { footerClose().click() })
    expect(document.body.textContent).not.toContain('入力を破棄しますか？')
    await waitClosed()
    await act(async () => { button('作成・編集のその他の操作').click() })
    await act(async () => { button('下書きを保存').click(); await Promise.resolve(); await Promise.resolve() })
    expect(state.saved?.definition?.internalMemo ?? state.saved?.internalMemo).toBe('引き継ぎあり')
  })
})
