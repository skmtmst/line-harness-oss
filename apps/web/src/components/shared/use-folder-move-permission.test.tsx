// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
const net = vi.hoisted(() => ({ move: vi.fn(), reload: vi.fn(), toast: vi.fn() }))
const picker = vi.hoisted(() => ({ confirm: null as null | ((id: string) => void) }))
vi.mock('./toast', () => ({ notifyToast: net.toast }))
vi.mock('./entity-picker', async importOriginal => {
  const original = await importOriginal<typeof import('./entity-picker')>()
  return { ...original, EntityPickerDialog: (props: ComponentProps<typeof original.EntityPickerDialog>) => {
    picker.confirm = props.onConfirm as (id: string) => void
    return <original.EntityPickerDialog {...props} />
  } }
})
import { FolderMovePermissionError, useFolderMove } from './use-folder-move'
const items = [{ id: 'one', name: '一件目' }, { id: 'two', name: '二件目' }, { id: 'three', name: '三件目' }]
const reason = 'この操作はオーナーか管理者だけができます。'
let allowed = true
let latest!: ReturnType<typeof useFolderMove<(typeof items)[number]>>
function Harness({ accountId = 'a', canEdit = true, lockedReason, fresh = false, staticAllowed }: { accountId?: string; canEdit?: boolean; lockedReason?: string; fresh?: boolean; staticAllowed?: boolean }) {
  latest = useFolderMove({ accountId, canEdit, items: fresh ? [...items] : items, folders: [], move: net.move, onChanged: net.reload, permission: { lockedReason, canWriteNow: () => staticAllowed ?? allowed } })
  return <>{latest.pageCheckbox}{items.map(item => <div key={item.id}>{latest.checkbox(item)}</div>)}{latest.overlays}</>
}
function openAll() {
  fireEvent.click(screen.getByLabelText('このページを全部選ぶ'))
  fireEvent.click(screen.getByRole('button', { name: 'フォルダへ移す' }))
  fireEvent.click(screen.getByRole('radio', { name: '未分類' }))
}
function confirm() { return within(screen.getByRole('dialog')).getByRole('button', { name: 'フォルダへ移す' }) as HTMLButtonElement }
beforeEach(() => { allowed = true; picker.confirm = null; net.move.mockReset().mockResolvedValue(undefined); net.reload.mockReset().mockResolvedValue(undefined); net.toast.mockReset() })
afterEach(cleanup)
it('未知でも同じ選択欄を残し、理由なしのdisabledにして移動を送らない', () => {
  allowed = false
  render(<Harness canEdit={false} />)
  expect(screen.getAllByRole('checkbox')).toHaveLength(4)
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect((checkbox as HTMLInputElement).disabled).toBe(true)
    expect(checkbox.hasAttribute('data-permission-locked')).toBe(false)
    fireEvent.click(checkbox)
  }
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(latest.isSelected('one')).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(net.move).not.toHaveBeenCalled()
})
it('閲覧のみの選択欄は灰色でTabに残り、理由を示して選択も保存もしない', () => {
  allowed = false
  render(<Harness canEdit={false} lockedReason={reason} />)
  const row = screen.getByLabelText('一件目を選ぶ') as HTMLInputElement
  expect(row.disabled).toBe(false); expect(row.tabIndex).toBe(0)
  expect(row.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(row)
  expect(screen.getByRole('tooltip').textContent).toContain(reason)
  fireEvent.click(row); fireEvent.change(row, { target: { checked: true } })
  fireEvent.keyDown(row, { key: 'Enter' }); fireEvent.keyDown(row, { key: ' ' })
  expect(latest.isSelected('one')).toBe(false)
  expect(net.move).not.toHaveBeenCalled()
})
it('開いた窓と選択は役割変更でも残し、読む候補を保って確定と古い操作だけを止める', async () => {
  const view = render(<Harness />)
  openAll()
  const dialog = screen.getByRole('dialog')
  expect(picker.confirm).toBeTypeOf('function')
  const retained = picker.confirm!
  const retainedOpen = latest.open
  allowed = false
  view.rerender(<Harness canEdit={false} lockedReason={reason} />)
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(latest.isSelected('one')).toBe(true)
  expect(screen.getByRole('radio', { name: '未分類' })).toBeTruthy()
  const save = confirm()
  expect(save.disabled).toBe(false); expect(save.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(save); expect(screen.getByRole('tooltip').textContent).toContain(reason)
  fireEvent.click(save); fireEvent.keyDown(save, { key: 'Enter' }); fireEvent.keyDown(save, { key: ' ' })
  await act(async () => { retained('__unfiled__'); retainedOpen(items[0]) })
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(screen.getByText('権限が変わったため、フォルダへの移動を中止しました。')).toBeTruthy()
  expect(net.move).not.toHaveBeenCalled()
  expect(net.reload).not.toHaveBeenCalled()
  allowed = true
  view.rerender(<Harness />)
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(net.move).not.toHaveBeenCalled()
  fireEvent.click(confirm())
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.move.mock.calls.map(([item]) => item.id)).toEqual(['one', 'two', 'three'])
  expect(net.reload).toHaveBeenCalledTimes(1)
})
it('選ぶ操作を保持しても現在の許可が無ければ選択と窓を変えない', () => {
  const view = render(<Harness />)
  const retained = latest
  allowed = false
  view.rerender(<Harness canEdit={false} lockedReason={reason} />)
  act(() => retained.open(items[0]))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(net.move).not.toHaveBeenCalled()
  expect(net.toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('権限が変わった'), { tone: 'error' })
})
it('1件目を待つ間に権限が変われば残りを送らず、失敗分だけ明示再試行する', async () => {
  let finish!: () => void
  net.move.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const view = render(<Harness />)
  openAll(); fireEvent.click(confirm())
  expect(net.move).toHaveBeenCalledTimes(1)
  allowed = false; view.rerender(<Harness canEdit={false} lockedReason={reason} />)
  await act(async () => finish())
  expect(net.move).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('dialog').textContent).toContain('2件を移せませんでした。権限が変わったため')
  expect(latest.isSelected('one')).toBe(false); expect(latest.isSelected('two')).toBe(true)
  expect(net.reload).toHaveBeenCalledTimes(1)
  allowed = true; view.rerender(<Harness />)
  expect(net.move).toHaveBeenCalledTimes(1)
  fireEvent.click(confirm())
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.move.mock.calls.map(([item]) => item.id)).toEqual(['one', 'two', 'three'])
  expect(net.reload).toHaveBeenCalledTimes(2)
})
it('呼ぶ側がreadからwriteの往復を検出した時は、権限の中断として残りを送らない', async () => {
  net.move.mockRejectedValueOnce(new FolderMovePermissionError())
  render(<Harness />)
  openAll(); fireEvent.click(confirm())
  await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('3件を移せませんでした。権限が変わったため'))
  expect(net.move).toHaveBeenCalledTimes(1)
  expect(net.reload).toHaveBeenCalledTimes(1)
  expect(net.toast).not.toHaveBeenCalled()
})
it('通信失敗を権限拒否と呼ばず、成功した行を再送しない', async () => {
  net.move.mockRejectedValueOnce(new Error('offline'))
  render(<Harness />)
  openAll(); fireEvent.click(confirm())
  await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('1件を移せませんでした。一覧とフォルダを読み直して'))
  expect(screen.getByRole('dialog').textContent).not.toContain('権限が変わった')
  expect(net.move).toHaveBeenCalledTimes(3)
  fireEvent.click(confirm())
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.move.mock.calls.map(([item]) => item.id)).toEqual(['one', 'two', 'three', 'one'])
})
it('アカウント切替は旧選択を捨て、旧処理の次の送信・GET・通知を止める', async () => {
  let finish!: () => void
  net.move.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const view = render(<Harness />)
  openAll(); fireEvent.click(confirm())
  view.rerender(<Harness accountId="b" />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(latest.isSelected('one')).toBe(false)
  await act(async () => finish())
  expect(net.move).toHaveBeenCalledTimes(1)
  expect(net.reload).not.toHaveBeenCalled(); expect(net.toast).not.toHaveBeenCalled()
})
it('同じ内容の配列と任意口を作り直しても選択と窓を捨てない', () => {
  const view = render(<Harness fresh />)
  openAll()
  const dialog = screen.getByRole('dialog')
  view.rerender(<Harness fresh />)
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(latest.isSelected('one')).toBe(true)
})
it.each([{ canEdit: false, current: true }, { canEdit: true, current: false }])('確定は描画時の許可と現在の許可を両方必要とする（$canEdit/$current）', async ({ canEdit, current }) => {
  const view = render(<Harness />)
  openAll()
  const retained = picker.confirm!
  expect(retained).toBeTypeOf('function')
  allowed = current
  view.rerender(<Harness canEdit={canEdit} />)
  await act(async () => retained('__unfiled__'))
  expect(net.move).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog').textContent).toContain('権限が変わったため')
})
it('窓を開いていない選択済みの一括口も残し、全選択と一括口に同じ理由を渡す', () => {
  const view = render(<Harness />)
  fireEvent.click(screen.getByLabelText('このページを全部選ぶ'))
  allowed = false; view.rerender(<Harness canEdit={false} lockedReason={reason} />)
  const page = screen.getByLabelText('このページを全部選ぶ') as HTMLInputElement
  const bulk = screen.getByRole('button', { name: 'フォルダへ移す' }) as HTMLButtonElement
  for (const control of [page, bulk]) {
    expect(control.disabled).toBe(false)
    expect(control.getAttribute('aria-disabled')).toBe('true')
    fireEvent.focus(control); expect(screen.getByRole('tooltip').textContent).toContain(reason)
    fireEvent.blur(control); fireEvent.click(control)
  }
  expect(latest.isSelected('one')).toBe(true)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(net.move).not.toHaveBeenCalled()
})
it('描画後に現在の許可だけ失った時も、行と全選択で選択を増やさない', () => {
  render(<Harness />)
  allowed = false
  fireEvent.click(screen.getByLabelText('一件目を選ぶ'))
  fireEvent.click(screen.getByLabelText('このページを全部選ぶ'))
  expect(latest.isSelected('one')).toBe(false)
  expect(latest.isSelected('two')).toBe(false)
  expect(screen.queryByRole('button', { name: 'フォルダへ移す' })).toBeNull()
  expect(net.move).not.toHaveBeenCalled()
})

it('開いた窓が未知になった時は理由を作らず普通disabledで確定を止める', () => {
  const view = render(<Harness />)
  openAll()
  const dialog = screen.getByRole('dialog')
  allowed = false; view.rerender(<Harness canEdit={false} />)
  const save = confirm()
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(save.disabled).toBe(true)
  expect(save.hasAttribute('data-permission-locked')).toBe(false)
  fireEvent.click(save)
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(net.move).not.toHaveBeenCalled()
})
it('保持した確定も、新しく渡された現在判定を読み直して拒む', async () => {
  const view = render(<Harness staticAllowed />)
  openAll()
  const retained = picker.confirm!
  view.rerender(<Harness staticAllowed={false} />)
  await act(async () => retained('__unfiled__'))
  expect(net.move).not.toHaveBeenCalled()
  expect(net.reload).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog').textContent).toContain('権限が変わったため')
})

it('保持した拒否側の確定も、新しい許可callbackになった後の明示操作だけを1回進める', async () => {
  const view = render(<Harness staticAllowed />)
  openAll()
  view.rerender(<Harness staticAllowed={false} />)
  expect(confirm().disabled).toBe(true)
  const retained = picker.confirm!
  expect(retained).toBeTypeOf('function')
  view.rerender(<Harness staticAllowed />)
  expect(net.move).not.toHaveBeenCalled()
  await act(async () => retained('__unfiled__'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.move.mock.calls.map(([item]) => item.id)).toEqual(['one', 'two', 'three'])
  expect(net.reload).toHaveBeenCalledTimes(1)
})
function LegacyHarness({ canEdit }: { canEdit: boolean }) {
  latest = useFolderMove({ accountId: 'a', canEdit, items, folders: [], move: net.move, onChanged: net.reload })
  return <>{latest.pageCheckbox}{items.map(item => <div key={item.id}>{latest.checkbox(item)}</div>)}{latest.overlays}</>
}
it('任意口を指定しない従来の利用ではcanEditを失うと選択と窓を捨てる', () => {
  const view = render(<LegacyHarness canEdit />)
  openAll()
  expect(latest.isSelected('one')).toBe(true)
  expect(screen.getByRole('dialog')).toBeTruthy()
  view.rerender(<LegacyHarness canEdit={false} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  view.rerender(<LegacyHarness canEdit />)
  expect(latest.isSelected('one')).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(net.move).not.toHaveBeenCalled()
})
