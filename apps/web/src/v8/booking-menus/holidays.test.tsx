// @vitest-environment happy-dom
/*
 * 監査 WEB055/056：休業日のタブ。
 * - 056：31日より長い休みも、32日目から先を休みとして扱う（打ち切らない）
 * - 055：削除の失敗は、開いている削除の確認の中に出し、窓を閉じない
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor,fireEvent,within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingException, BookingSettings } from '@/lib/api'
import { closedOn, closedRanges, closedSpan } from './lib/closed-ranges'

const net = vi.hoisted(() => ({ deleteException: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, bookingApi: { ...actual.bookingApi, deleteException: net.deleteException } }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))

const { HolidaysTabV8 } = await import('./tabs/holidays-tab')

afterEach(() => { cleanup(); vi.clearAllMocks() })

const exception = (id: string, dateFrom: string, dateTo: string): BookingException => ({
  id, lineAccountId: 'a', scopeKind: 'store', scopeId: null, date: null, dateFrom, dateTo, kind: 'closed',
  intervals: [], reason: '改装', note: null, version: 1, createdAt: '', updatedAt: '',
})

describe('長い休み（WEB056）', () => {
  it('45日の休みの40日目も休み', () => {
    const ranges = closedRanges([exception('e1', '2026-12-01', '2027-01-14')])
    expect(closedOn(ranges, '2027-01-09')?.id).toBe('e1')
    expect(closedOn(ranges, '2027-01-15')).toBeUndefined()
    expect(closedSpan(ranges)).toEqual({ from: '2026-12-01', to: '2027-01-14' })
  })
})

describe('休業日の削除の失敗（WEB055）', () => {
  it('失敗の理由を削除の確認の中に出し、窓は開いたまま', async () => {
    const { ApiError } = await import('@/lib/api')
    net.deleteException.mockRejectedValue(new ApiError(500, 'down'))
    const item = exception('e1', '2026-10-20', '2026-10-20')
    const settings = { exceptions: [item] } as unknown as BookingSettings
    render(<HolidaysTabV8 accountId="a" settings={settings} status="ready" error={null} exceptions={[item]} closedWeekdays={[]} bookingCountOnClosed={0} canEdit onSaved={() => undefined} onReload={() => undefined} />)
    await act(async () => { screen.getByRole('button', { name: '削除' }).click() })
    await act(async () => { screen.getByRole('button', { name: '削除する', exact: true }).click() })
    await waitFor(() => expect(net.deleteException).toHaveBeenCalled())
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.getByRole('dialog'))
    expect(dialog.textContent).toContain('削除')
    expect(dialog.textContent).toContain('休業日を消せませんでした')
  })
})

it.each(['cancel','close','escape','backdrop'])('DC-UI-03：実休業日入力の%sでも同じ破棄確認を出して入力を残す',async path=>{
 document.documentElement.dataset.theme='v8'
 const item=exception('e1','2026-10-20','2026-10-20')
 render(<HolidaysTabV8 accountId="a" settings={{exceptions:[item]} as BookingSettings} status="ready" error={null} exceptions={[item]} closedWeekdays={[]} bookingCountOnClosed={0} canEdit onSaved={()=>{}} onReload={()=>{}}/>)
 fireEvent.click(screen.getByText('改装').previousElementSibling!)
 fireEvent.change(screen.getByLabelText('休業の理由'),{target:{value:'入力を保持'}})
 const dialog=screen.getByRole('dialog',{name:'休業日を直す'})
 if(path==='cancel')fireEvent.click(within(dialog).getByRole('button',{name:'キャンセル'}))
 else if(path==='close')fireEvent.click(within(dialog).getByRole('button',{name:'閉じる'}))
 else if(path==='escape')fireEvent.keyDown(document,{key:'Escape'})
 else fireEvent.mouseDown(dialog.parentElement!)
 const confirm=screen.getByRole('dialog',{name:'入力を破棄しますか？'})
 fireEvent.click(within(confirm).getByRole('button',{name:'編集を続ける'}))
 expect((screen.getByLabelText('休業の理由') as HTMLInputElement).value).toBe('入力を保持')
 delete document.documentElement.dataset.theme
})

it('Q01：日付は必須・理由は任意。空と逆順は欄下に示して入力を残す', async () => {
  render(<HolidaysTabV8 accountId="a" settings={{ exceptions: [] } as unknown as BookingSettings} status="ready" error={null} exceptions={[]} closedWeekdays={[]} bookingCountOnClosed={0} canEdit onSaved={() => {}} onReload={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '臨時休業を足す' }))
  const dialog = screen.getByRole('dialog', { name: '臨時休業を足す' })
  const from = within(dialog).getByLabelText<HTMLButtonElement>('休業の開始日')
  const to = within(dialog).getByLabelText<HTMLButtonElement>('休業の終了日')
  const reason = within(dialog).getByLabelText<HTMLInputElement>('休業の理由')
  expect(within(dialog).getAllByText('必須')).toHaveLength(2)
  expect(within(dialog).getAllByText('任意')).toHaveLength(1)
  fireEvent.change(reason, { target: { value: '入力を残す' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '休業日を保存する' }))
  expect(from.getAttribute('aria-invalid')).toBe('true')
  expect(to.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(from.getAttribute('aria-describedby')!.split(' ').at(-1)!)?.textContent).toBe('開始日を入れてください。')
  fireEvent.click(from)
  fireEvent.click(screen.getByRole('button', { name: /2026年10月20日/ }))
  fireEvent.click(to)
  fireEvent.click(screen.getByRole('button', { name: /2026年10月19日/ }))
  fireEvent.click(within(dialog).getByRole('button', { name: '休業日を保存する' }))
  expect(within(dialog).getByText('終了日は開始日以降にしてください。')).toBeTruthy()
  expect(from.textContent).toContain('2026年10月20日')
  expect(to.textContent).toContain('2026年10月19日')
  expect(reason.value).toBe('入力を残す')
})
