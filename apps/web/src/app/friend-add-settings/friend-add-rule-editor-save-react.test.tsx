// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- lightweight component mocks for interaction coverage */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ search: 'step=basic', failure: '', requests: 0, pending: null as null | (() => void), throwError: null as unknown }))
const navigation = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useSearchParams: () => new URLSearchParams(state.search) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/dialog', () => ({ default: () => null }))
vi.mock('@/components/shared/icon-button', () => ({ default: () => null }))
vi.mock('@/components/shared/list-state', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock('@/components/shared/select-field', () => ({ default: ({ value, onChange, options }: any) => <select value={value} onChange={onChange}>{options.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}</select> }))
vi.mock('@/components/shared/sticky-bar', () => ({ default: ({ actions }: any) => <div>{actions}</div> }))
vi.mock('@/components/shared/text-field', () => ({ TextField: (props: any) => <input {...props} />, TextArea: (props: any) => <textarea {...props} /> }))
vi.mock('@/components/shared/button', () => ({ default: ({ href, children, ...props }: any) => href ? <a href={href}>{children}</a> : <button {...props}>{children}</button> }))
vi.mock('@/lib/api', async (importOriginal) => {
  // 失敗の文の分け方（describeSaveFailure）は本物で確かめる。通信の口だけ差し替える。
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { friendAddRules: {
    list: vi.fn(async () => ({ success: true, data: { items: [], options: { routes: [{ id: 'route-1', name: '紹介QR', kind: 'QR' }], scenarios: [], tags: [], folders: [] } } })),
    conflicts: vi.fn(async () => ({ success: true, data: { rules: [], conflicts: [] } })),
    createDraft: vi.fn(async () => { state.requests += 1; if (state.throwError) throw state.throwError; if (state.pending) return new Promise((resolve) => { const done = state.pending; state.pending = () => { done(); resolve({ success: true, data: { id: 'rule-1', version: 1 } }) } }); return state.failure ? { success: false, error: state.failure } : { success: true, data: { id: 'rule-1', version: 1 } } }),
    saveDraft: vi.fn(), test: vi.fn(), get: vi.fn(),
  } } }
})

const { default: Editor } = await import('./friend-add-rule-editor')
let host: HTMLDivElement; let root: Root
beforeEach(() => { state.search = 'step=basic'; state.failure = ''; state.requests = 0; state.pending = null; state.throwError = null; navigation.replace.mockReset(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.restoreAllMocks() })
async function render() { await act(async () => { root.render(<Editor />); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); await Promise.resolve() }) }
function button(label: string) { const node = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(label)); if (!node) throw new Error(`${label}: ${host.textContent}`); return node }
async function name(value: string) { const input = host.querySelector('input'); if (!input) throw new Error('name'); await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) }) }

describe('N-105 友だち追加時配信の段移動保存', () => {
  it('変更なしなら保存せず次の段と戻る段へ移動する', async () => { await render(); await act(async () => { button('流入条件').click() }); expect(state.requests).toBe(0); expect(navigation.replace).toHaveBeenLastCalledWith('/friend-add-settings?view=new&step=routes'); state.search = 'step=routes'; await render(); await act(async () => { button('基本設定').click() }); expect(navigation.replace).toHaveBeenLastCalledWith('/friend-add-settings?view=new&step=basic') })
  it('変更ありは保存成功後だけ次の段へ進む', async () => { await render(); await name('秋の案内'); await act(async () => { button('流入条件').click(); await Promise.resolve() }); expect(state.requests).toBe(1); expect(navigation.replace).toHaveBeenLastCalledWith('/friend-add-settings?view=edit&id=rule-1&step=routes') })
  it('保存失敗と競合では入力を残して移動しない', async () => { for (const failure of ['通信に失敗しました。通信を確かめて、もう一度お試しください。', '別の画面で更新されました']) { state.failure = failure; await render(); await name('残す入力'); await act(async () => { button('流入条件').click(); await Promise.resolve() }); expect(host.textContent).toContain(failure); expect((host.querySelector('input') as HTMLInputElement).value).toBe('残す入力'); expect(navigation.replace).not.toHaveBeenCalled(); await act(async () => { root.unmount() }); host.innerHTML = ''; root = createRoot(host) } })
  it('保存開始直後の二重押下は1回だけ保存する', async () => { await render(); await name('連打防止'); let release!: () => void; state.pending = () => { release = () => undefined }; await act(async () => { button('流入条件').click(); button('流入条件').click() }); expect(state.requests).toBe(1); await act(async () => { state.pending?.(); await Promise.resolve() }); void release })
})

describe('R30 段移動ではその段の欄だけ確かめ欄の下に出す', () => {
  async function toggleWeekday() {
    const input = host.querySelector('.friend-add-editor-weekdays input')
    if (!input) throw new Error(`weekday: ${host.textContent}`)
    await act(async () => { (input as HTMLInputElement).click() })
  }
  async function toggleRoute() {
    const input = host.querySelector('.friend-add-editor-routeList input')
    if (!input) throw new Error(`route: ${host.textContent}`)
    await act(async () => { (input as HTMLInputElement).click() })
  }
  async function writeMessage(value: string) {
    const area = host.querySelector('textarea')
    if (!area) throw new Error('message')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(area, value)
      area.dispatchEvent(new Event('input', { bubbles: true }))
      area.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  it('流入条件の段では流入リンクの不足を欄の下に出し保存しない', async () => {
    await render()
    await name('秋の案内')
    await act(async () => { button('流入条件').click(); await Promise.resolve() })
    expect(state.requests).toBe(1)
    state.search = 'step=routes'
    await render()
    await toggleWeekday()
    await act(async () => { button('初回案内').click(); await Promise.resolve() })
    expect(state.requests).toBe(1)
    expect(host.querySelector('.friend-add-editor-fieldError')?.textContent).toContain('対象にする流入リンクを1つ以上選んでください')
    expect(host.querySelector('.friend-add-editor-error')).toBeNull()
  })
  it('初回案内の段ではシナリオの不足を欄の下に出し保存しない', async () => {
    await render()
    await name('秋の案内')
    await act(async () => { button('流入条件').click(); await Promise.resolve() })
    state.search = 'step=routes'
    await render()
    await toggleRoute()
    await act(async () => { button('初回案内').click(); await Promise.resolve() })
    expect(state.requests).toBe(2)
    state.search = 'step=message'
    await render()
    await writeMessage('こんにちは')
    await act(async () => { button('アクション').click(); await Promise.resolve() })
    expect(state.requests).toBe(2)
    expect(host.querySelector('.friend-add-editor-fieldError')?.textContent).toContain('実際に配信するシナリオを決めてください')
    expect(host.querySelector('.friend-add-editor-error')).toBeNull()
  })
  it('入力の失敗は原因どおりに出し通信の文に置き換えない', async () => {
    const { ApiError } = await import('@/lib/api')
    state.throwError = new ApiError(400, '実際に配信するシナリオを決めてください。')
    await render()
    await name('秋の案内')
    await act(async () => { button('流入条件').click(); await Promise.resolve(); await Promise.resolve() })
    expect(host.querySelector('.friend-add-editor-error')?.textContent).toContain('実際に配信するシナリオを決めてください')
    expect(host.textContent).not.toContain('接続を確かめて')
    expect(navigation.replace).not.toHaveBeenCalled()
  })
  it('通信の失敗のときだけ通信の文を出す', async () => {
    state.throwError = new TypeError('Load failed')
    await render()
    await name('秋の案内')
    await act(async () => { button('流入条件').click(); await Promise.resolve(); await Promise.resolve() })
    expect(host.querySelector('.friend-add-editor-error')?.textContent).toContain('接続を確かめて')
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
