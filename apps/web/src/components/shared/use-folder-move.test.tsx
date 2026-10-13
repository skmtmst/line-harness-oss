// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Folder } from '@line-crm/shared'
const net = vi.hoisted(() => ({ move: vi.fn(), reload: vi.fn(), toast: vi.fn() }))
vi.mock('./toast', () => ({ notifyToast: net.toast }))
vi.mock('./entity-picker', () => ({ EntityPickerDialog: (props: { onConfirm: (id: string) => void; onCancel: () => void; error: string; busy: boolean }) => <div role="dialog">
  <button disabled={props.busy} onClick={() => props.onConfirm('folder')}>分類へ確定</button>
  <button disabled={props.busy} onClick={() => props.onConfirm('__unfiled__')}>未分類へ確定</button>
  <button onClick={props.onCancel}>キャンセル</button><span>{props.error}</span>
</div> }))
import { useFolderMove } from './use-folder-move'

const items = [{ id: 'one', name: '一件目' }, { id: 'two', name: '二件目' }]
let renders = 0
function Harness({ accountId = 'a', canEdit = true, freshItems = false }: { accountId?: string; canEdit?: boolean; freshItems?: boolean }) {
  renders += 1
  if (renders > 30) throw new Error('同じ選択内容で再描画を繰り返しています')
  const move = useFolderMove({ accountId, canEdit, items: freshItems ? [...items] : items, folders: [] as Folder[], move: net.move, onChanged: net.reload })
  return <>{move.pageCheckbox}{items.map((item) => <div key={item.id}>{move.checkbox(item)}<button onClick={() => move.open(item)}>移す:{item.id}</button></div>)}{move.overlays}</>
}
beforeEach(() => { renders = 0; net.move.mockReset().mockResolvedValue(undefined); net.reload.mockReset(); net.toast.mockReset() })
afterEach(cleanup)

it('一覧が毎回新しい配列でも、同じ選択内容の更新は再描画を繰り返さない', () => {
  render(<Harness freshItems />)
  expect(renders).toBeLessThan(5)
  fireEvent.click(screen.getByLabelText('このページを全部選ぶ'))
  expect(screen.getByRole('button', { name: 'フォルダへ移す' })).toBeTruthy()
  expect(renders).toBeLessThan(8)
})

it('行の移動は確定まで送らず、キャンセルは入力を変えず未分類はnullを送る', async () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('移す:one'))
  expect(net.move).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('キャンセル'))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByText('移す:one'))
  fireEvent.click(screen.getByText('未分類へ確定'))
  await waitFor(() => expect(net.move).toHaveBeenCalledWith(items[0], null))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('まとめ移動は失敗した行だけを再送し、二重確定を止める', async () => {
  net.move.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(<Harness />)
  fireEvent.click(screen.getByLabelText('このページを全部選ぶ'))
  fireEvent.click(screen.getByRole('button', { name: 'フォルダへ移す' }))
  fireEvent.click(screen.getByText('分類へ確定'))
  await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('1件を移せませんでした'))
  expect(net.move).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByText('分類へ確定'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.move.mock.calls.map(([item]) => item.id)).toEqual(['one', 'two', 'two'])
})

it('アカウント切り替え後は古い処理で次の行を動かさず、一覧も更新しない', async () => {
  let finish!: () => void
  net.move.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const view = render(<Harness />)
  fireEvent.click(screen.getByLabelText('このページを全部選ぶ'))
  fireEvent.click(screen.getByRole('button', { name: 'フォルダへ移す' }))
  fireEvent.click(screen.getByText('分類へ確定'))
  view.rerender(<Harness accountId="b" />)
  await act(async () => { finish() })
  expect(net.move).toHaveBeenCalledTimes(1)
  expect(net.reload).not.toHaveBeenCalled()
  expect(net.toast).not.toHaveBeenCalled()
})

it('閲覧のみでは選択と窓を隠して移動を送らない', () => {
  render(<Harness canEdit={false} />)
  expect(screen.queryByRole('checkbox')).toBeNull()
  fireEvent.click(screen.getByText('移す:one'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(net.move).not.toHaveBeenCalled()
})
