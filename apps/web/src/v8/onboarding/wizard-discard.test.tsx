// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStyle } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'
import StyleSetupWizard from './wizard'
import { styleLabel, type StyleState } from './model'

const calls = vi.hoisted(() => ({ save: vi.fn(), activate: vi.fn(), updated: vi.fn(), closed: vi.fn(), push: vi.fn() }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: {
  save: calls.save, activate: calls.activate,
  starterSet: vi.fn(async () => ({ success: true, data: { definition: { items: [] }, preview: [] } })),
  starterItems: vi.fn(async () => ({ success: true, data: { items: [] } })),
} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'test-store', accounts: [{id:'test-store',name:'Test store'}], selectedAccount: {id:'test-store',name:'Test store'} }) }))
vi.mock('@/hooks/use-account-style', () => ({ accountStyleUpdated: calls.updated }))
vi.mock('@/components/shared/list-navigation', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
  useListNavigationRouter: () => ({ push: calls.push }),
}))

const initialState: StyleState = { style: 'standard', styleSelected: true, styleMode: 'configured', version: 7, answers: { image: { mode: 'configured', value: 'keep' } } }
function Subject({ state = initialState }: { state?: StyleState }) {
  const [open, setOpen] = useState(true)
  return open ? <StyleSetupWizard accountId="test-store" state={state} onClose={changed => { calls.closed(changed); setOpen(false) }} /> : <p>閉じました</p>
}
beforeEach(() => {
  vi.clearAllMocks()
  setTestReducedMotion(true)
  document.documentElement.dataset.theme = 'v8'
  calls.save.mockResolvedValue({ success: true, data: { version: 8 } })
})
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

/* 1 問目：上の切り替えで見て、［このスタイルにする］で選ぶ（選んでいる札は名前の後ろに「選んでいます」）。 */
function pickStyle(style: AccountStyle) {
  const group = screen.getByRole('group', { name: '見るスタイル' })
  fireEvent.click(within(group).getByRole('button', { name: new RegExp(`^${styleLabel(style)}`) }))
  const choose = screen.queryByRole('button', { name: 'このスタイルにする' })
  if (choose) fireEvent.click(choose)
}
function chosenStyle(style: AccountStyle) {
  return within(screen.getByRole('group', { name: '見るスタイル' })).queryByRole('button', { name: `${styleLabel(style)}（選んでいます）` })
}
async function chooseStyle(style: AccountStyle) {
  pickStyle(style)
  fireEvent.click(screen.getByRole('button', { name: '次へ' }))
  await screen.findByRole('dialog', { name: '最初のリッチメニューを選ぶ' })
}
function requestClose(method: 'close' | 'escape' | 'backdrop') {
  const dialog = screen.getByRole('dialog', { name: '最初のリッチメニューを選ぶ' })
  if (method === 'close') fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
  else if (method === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
  else fireEvent.mouseDown(dialog.parentElement!)
}

describe('はじめの質問の保存と破棄', () => {
  it('何も変えずに閉じると確認も保存も不要', async () => {
    render(<Subject />)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    await screen.findByText('閉じました')
    expect(calls.save).not.toHaveBeenCalled()
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('最初のスタイル選択だけ変えた場合も、共通の確認で破棄できる', async () => {
    render(<Subject />)
    pickStyle('ec')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    fireEvent.click(await screen.findByRole('button', { name: '破棄する' }))
    await screen.findByText('閉じました')
    expect(calls.save).not.toHaveBeenCalled()
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(false)
  })

  it.each(['salon', 'ec'] as const)('標準から%sへ進めても、破棄したら保存・有効化せず元の状態で開き直せる', async style => {
    const state = structuredClone(initialState)
    const before = structuredClone(state)
    const view = render(<Subject state={state} />)
    await chooseStyle(style)
    requestClose('close')
    fireEvent.click(await screen.findByRole('button', { name: '破棄する' }))
    await screen.findByText('閉じました')
    expect(calls.save).not.toHaveBeenCalled()
    expect(calls.activate).not.toHaveBeenCalled()
    expect(calls.updated).not.toHaveBeenCalled()
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(false)
    expect(state).toEqual(before)
    view.unmount()
    render(<Subject state={state} />)
    expect(chosenStyle('standard')).not.toBeNull()
  })

  it.each(['escape', 'backdrop'] as const)('%sから破棄しても保存はしない', async method => {
    render(<Subject />)
    await chooseStyle('salon')
    requestClose(method)
    fireEvent.click(await screen.findByRole('button', { name: '破棄する' }))
    await screen.findByText('閉じました')
    expect(calls.save).not.toHaveBeenCalled()
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('編集を続けると選択・手順を保ち、保存も終了もしない', async () => {
    render(<Subject />)
    await chooseStyle('ec')
    requestClose('close')
    fireEvent.click(await screen.findByRole('button', { name: '編集を続ける' }))
    expect(screen.getByRole('dialog', { name: '最初のリッチメニューを選ぶ' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'スタイルを選び直す' }))
    expect(chosenStyle('ec')).not.toBeNull()
    expect(calls.save).not.toHaveBeenCalled()
    expect(calls.closed).not.toHaveBeenCalled()
  })

  it('途中保存して閉じると表示中の版を付けて一度だけ保存する', async () => {
    render(<Subject />)
    await chooseStyle('salon')
    fireEvent.click(screen.getByRole('radio',{name:/シンプルなメニュー/}))
    fireEvent.click(screen.getByRole('button', { name: '途中保存して閉じる' }))
    await screen.findByText('閉じました')
    expect(calls.save).toHaveBeenCalledExactlyOnceWith('test-store', expect.objectContaining({ expectedVersion: 7, style: 'salon', answers: { image: { mode: 'configured', value: 'simple' } } }))
    expect(calls.updated).toHaveBeenCalledExactlyOnceWith('test-store')
    expect(calls.activate).not.toHaveBeenCalled()
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(true)
  })

  it.each([409, 503])('途中保存が%sなら入力を残し、保存した扱いで閉じない', async status => {
    calls.save.mockRejectedValueOnce(new ApiError(status))
    render(<Subject />)
    await chooseStyle('salon')
    fireEvent.click(screen.getByRole('button', { name: '途中保存して閉じる' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBeTruthy())
    expect(screen.getByRole('dialog', { name: '最初のリッチメニューを選ぶ' })).toBeTruthy()
    expect(calls.closed).not.toHaveBeenCalled()
    expect(calls.updated).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'スタイルを選び直す' }))
    expect(chosenStyle('salon')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    requestClose('close')
    fireEvent.click(await screen.findByRole('button', { name: '破棄する' }))
    await screen.findByText('閉じました')
    expect(calls.save).toHaveBeenCalledTimes(1)
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('途中保存中は二重保存・Esc・背景・×で終了しない', async () => {
    let complete!: (value: unknown) => void
    calls.save.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    render(<Subject />)
    await chooseStyle('salon')
    const saveButton = screen.getByRole('button', { name: '途中保存して閉じる' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)
    requestClose('escape')
    requestClose('backdrop')
    requestClose('close')
    await waitFor(() => expect(calls.save).toHaveBeenCalledTimes(1))
    expect(calls.closed).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '破棄する' })).toBeNull()
    complete({ success: true, data: { version: 8 } })
    await screen.findByText('閉じました')
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(true)
  })

  it.each(['later', 'manual'] as const)('%sのボタンは、明示的な設定保存として残す', async mode => {
    render(<Subject />)
    fireEvent.click(screen.getByRole('button', { name: mode === 'later' ? 'あとで設定する' : '手動で設定する' }))
    await screen.findByText('閉じました')
    expect(calls.save).toHaveBeenCalledExactlyOnceWith('test-store', { expectedVersion: 7, styleMode: mode })
    expect(calls.activate).not.toHaveBeenCalled()
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(true)
    if (mode === 'manual') expect(calls.push).toHaveBeenCalledExactlyOnceWith('/settings')
  })

  it('最後の一覧への保存を維持し、一覧を閉じても追加保存・有効化しない', async () => {
    render(<Subject />)
    await chooseStyle('standard')
    fireEvent.click(screen.getByRole('button', { name: 'このメニューで進む' }))
    await waitFor(() => expect(document.querySelector('input[name="setup-content"]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    const summary = await screen.findByRole('dialog', { name: '準備ができました' })
    await waitFor(() => expect(summary.getAttribute('aria-busy')).not.toBe('true'))
    expect(calls.save).toHaveBeenCalledTimes(1)
    expect(calls.save).toHaveBeenCalledWith('test-store', expect.objectContaining({ expectedVersion: 7, style: 'standard', confirmInitialMenu:true,answers: {image:{mode:'configured',value:'simple'}, content: { mode: 'configured', value: true } } }))
    fireEvent.click(within(summary).getByRole('button', { name: '閉じる' }))
    const discard = screen.queryByRole('button', { name: '破棄する' })
    if (discard) fireEvent.click(discard)
    await screen.findByText('閉じました')
    expect(calls.save).toHaveBeenCalledTimes(1)
    expect(calls.activate).not.toHaveBeenCalled()
    expect(calls.closed).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('予約設定を変える最終保存は確認前に送らず、確認取消でも入力を保つ', async () => {
    render(<Subject state={{ ...initialState, style: 'salon', answers: { ...initialState.answers, approval: { mode: 'configured', value: 'automatic' } } }} />)
    await chooseStyle('salon')
    fireEvent.click(screen.getByRole('button', { name: 'このメニューで進む' }))
    await waitFor(() => expect(document.querySelector('input[name="setup-approval"]')).not.toBeNull())
    fireEvent.click(document.querySelector<HTMLInputElement>('input[name="setup-approval"][value="require_approval"]')!)
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    await screen.findByRole('dialog', { name: '予約のときのお支払いはどうしますか？' })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'はじめの質問の一覧' })).getByRole('button', { name: '営業時間' }))
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    const confirm = await screen.findByRole('dialog', { name: '予約設定が変わります' })
    expect(calls.save).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'キャンセル' }))
    expect(calls.save).not.toHaveBeenCalled()
    expect(calls.closed).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: '次へ' }))
    fireEvent.click(await screen.findByRole('button', { name: '変えて保存する' }))
    await screen.findByRole('dialog', { name: '準備ができました' })
    expect(calls.save).toHaveBeenCalledExactlyOnceWith('test-store', expect.objectContaining({ expectedVersion: 7, answers: expect.objectContaining({ approval: { mode: 'configured', value: 'manual' } }) }))
  })
})


it('別スタイルで確かめたメニューの確認を、飲食店への途中保存で使い回さない',async()=>{
 render(<Subject/>);
 await chooseStyle('standard');
 fireEvent.click(screen.getByRole('button',{name:'このメニューで進む'}));
 await waitFor(()=>expect(document.querySelector('input[name="setup-content"]')).not.toBeNull());
 fireEvent.click(within(screen.getByRole('navigation',{name:'はじめの質問の一覧'})).getByRole('button',{name:/使い方のスタイル/}));
 await chooseStyle('restaurant');
 requestClose('close');
 fireEvent.click(await screen.findByRole('button',{name:'途中保存して閉じる'}));
 await screen.findByText('閉じました');
 expect(calls.save).toHaveBeenCalledWith('test-store',expect.objectContaining({style:'restaurant'}));
 expect(calls.save.mock.calls[0][1].confirmInitialMenu).toBeUndefined();
});
