// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- lightweight component mocks for interaction coverage */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, getByRole } from '@testing-library/react'

const state = vi.hoisted(() => ({ search: 'step=basic', failure: '', requests: 0, pending: null as null | (() => void), throwError: null as unknown }))
const navigation = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/friend-add-settings/new', useRouter: () => navigation, useSearchParams: () => new URLSearchParams(state.search) }))
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
  // 失敗の文の分け方（describeSaveFailure）は本物で確かめる。通信の口だけ差し替える。
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { friendAddRules: {
    list: vi.fn(async () => ({ success: true, data: { items: [], options: { routes: [{ id: 'route-1', name: '紹介QR', kind: 'QR' }], scenarios: [], tags: [], folders: [] } } })),
    conflicts: vi.fn(async () => ({ success: true, data: { rules: [], conflicts: [] } })),
    createDraft: vi.fn(async () => { state.requests += 1; if (state.throwError) throw state.throwError; if (state.pending) return new Promise((resolve) => { const done = state.pending; state.pending = () => { done(); resolve({ success: true, data: { id: 'rule-1', version: 1 } }) } }); return state.failure ? { success: false, error: state.failure } : { success: true, data: { id: 'rule-1', version: 1 } } }),
    saveDraft: vi.fn(), test: vi.fn(), get: vi.fn(async () => ({ success: true, data: { rule: { id: 'rule-1', name: '保存済みの案内', friendKind: 'returning', folderName: null, priority: 1, version: 1, status: 'draft', isFallback: false, definition: { returningMode: 'other', routeIds: [], messageType: 'text', messageText: '', scenarioId: null, friendCondition: '', actions: [] } }, options: { routes: [], scenarios: [], tags: [], folders: [] } } })),
  } } }
})

const { default: Editor } = await import('@/v8/friend-add/editor')
let host: HTMLDivElement; let root: Root; let historyReplace: ReturnType<typeof vi.spyOn>
beforeEach(() => { window.history.replaceState(null, '', '/friend-add-settings?view=new&step=basic'); historyReplace = vi.spyOn(window.history, 'replaceState'); Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }); state.search = 'step=basic'; state.failure = ''; state.requests = 0; state.pending = null; state.throwError = null; navigation.replace.mockReset(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.restoreAllMocks() })
async function render(ruleId?: string) { await act(async () => { root.render(<Editor ruleId={ruleId} />); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); await Promise.resolve() }) }
function button(label: string) { const node = [...host.querySelectorAll('button')].find((item) => !item.disabled && item.textContent?.includes(label)); if (!node) throw new Error(`${label}: ${host.textContent}`); return node }


it('初回メッセージの入力を残して窓を閉じた後、画面の離脱は実際の親が確認する', async () => {
  state.search = 'step=message'
  await render('rule-1')
  await act(async () => { button('初回メッセージを確認・変更').click() })
  const dialog = document.querySelector('[role="dialog"]')!
  const area = dialog.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]')!
  await act(async () => { area.textContent = '離脱前に残すメッセージ'; fireEvent.input(area) })
  await act(async () => { dialog.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!.click() })
  const link = document.createElement('a'); link.href = '/friends'; link.textContent = '別画面へ'; document.body.append(link)
  try {
    await act(async () => { link.click() })
    expect(document.body.textContent).toContain('保存していない変更があります')
    expect(document.body.textContent).toContain('追加時の動きへの変更')
    expect(state.requests).toBe(0)
  } finally { link.remove() }
})
