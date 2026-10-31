// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ save: undefined as undefined | (() => void), discard: undefined as undefined | (() => void) }))
vi.mock('@/components/shared/button', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/shared/button')>()
  return { ...actual, default: (props: React.ComponentProps<typeof actual.default>) => {
    const text = React.Children.toArray(props.children).filter(child => typeof child === 'string').join('')
    if (text === '保存せずに移る' && props.onClick) {
      const handler = props.onClick
      fixture.discard = () => Reflect.apply(handler, undefined, [new MouseEvent('click')])
    }
    if (props.children === '保存して移る' && props.onClick) {
      const handler = props.onClick
      fixture.save = () => Reflect.apply(handler, undefined, [new MouseEvent('click')])
    }
    return <actual.default {...props} />
  } }
})

import { UnsavedLeaveDialog } from './unsaved-leave-dialog'
import Button from '@/components/shared/button'
import Dialog, { DialogActions } from '@/components/shared/dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'

afterEach(cleanup)

describe('UnsavedLeaveDialog（未保存ガードの共通窓）', () => {
  it('文言は固定で、画面ごとの違いは subject の名詞だけ（★管理画面 sTJsh §5）', () => {
    render(<UnsavedLeaveDialog open subject="入力した共通情報" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '保存していない変更があります' })).toBeTruthy()
    expect(screen.getByText('このまま移ると、入力した共通情報が消えます。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存せずに移る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '編集を続ける' })).toBeTruthy()
  })

  it('subject を省いたときは「入力した内容」になる', () => {
    render(<UnsavedLeaveDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('このまま移ると、入力した内容が消えます。')).toBeTruthy()
  })

  it('残る方が主の緑で、離れる方は枠線（印は付けない）', () => {
    render(<UnsavedLeaveDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const stay = screen.getByRole('button', { name: '編集を続ける' })
    const leave = screen.getByRole('button', { name: '保存せずに移る' })
    expect(stay.className).toMatch(/primary/)
    expect(leave.className).not.toMatch(/primary/)
    expect(leave.className).not.toMatch(/danger/)
    expect(document.querySelector('svg.lucide-circle-check')).toBeNull()
  })

  it('「保存せずに移る」「編集を続ける」がそのまま届く', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<UnsavedLeaveDialog open onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('onSave があるときは「保存して移る」が出て、残る口は右上の×', () => {
    const onSave = vi.fn(async () => true)
    render(<UnsavedLeaveDialog open onSave={onSave} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: '保存して移る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存せずに移る' })).toBeTruthy()
    // 移る系の2択だけ。「編集を続ける」は出さず、× で残る（UI-25）。
    expect(screen.queryByRole('button', { name: '編集を続ける' })).toBeNull()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy()
  })

  it('「保存して移る」は保存が通ったときだけ移動を続ける', async () => {
    const onSave = vi.fn(async () => true)
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<UnsavedLeaveDialog open onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '保存して移る' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('保存が通らなければ移動せず画面へ戻す', async () => {
    const onSave = vi.fn(async () => false)
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<UnsavedLeaveDialog open onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '保存して移る' }))
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('閉じているときは何も描かない', () => {
    render(<UnsavedLeaveDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
  })
})

it('権限で保存できなくても同じ保存操作と理由を残し、破棄と閉じるは使える', () => {
  const onSave = vi.fn(async () => true), onConfirm = vi.fn(), onCancel = vi.fn()
  render(<UnsavedLeaveDialog open saveDisabled saveLockedReason="権限のため変更できません。" onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
  const save = screen.getByRole('button', { name: '保存して移る' })
  expect(save.getAttribute('aria-disabled')).toBe('true')
  expect(save.getAttribute('data-permission-locked')).not.toBeNull()
  expect((save as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(save); fireEvent.keyDown(save, { key: 'Enter' })
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
})

it('本人確認中は理由なしのdisabled、許可確定後だけ保存して移れる', async () => {
  const onSave = vi.fn(async () => true), onConfirm = vi.fn(), onCancel = vi.fn()
  const view = render(<UnsavedLeaveDialog open saveDisabled onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
  const save = screen.getByRole('button', { name: '保存して移る' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  expect(save.getAttribute('data-permission-locked')).toBeNull()
  fireEvent.click(save); expect(onSave).not.toHaveBeenCalled()
  view.rerender(<UnsavedLeaveDialog open onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
  fireEvent.click(screen.getByRole('button', { name: '保存して移る' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  expect(onSave).toHaveBeenCalledTimes(1)
})

it('保持した保存口は後から付いたロックを守り、解除後の通常保存は1回', async () => {
  const onSave = vi.fn(async () => true), onConfirm = vi.fn(), onCancel = vi.fn()
  const view = render(<UnsavedLeaveDialog open onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
  const heldSave = fixture.save!
  view.rerender(<UnsavedLeaveDialog open saveDisabled saveLockedReason="権限のため変更できません。" onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
  await act(async () => { heldSave() })
  expect(onSave).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled()
  view.rerender(<UnsavedLeaveDialog open onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
  await act(async () => { fixture.save!() })
  expect(onSave).toHaveBeenCalledTimes(1); expect(onConfirm).toHaveBeenCalledTimes(1)
})


// 追加前の2通りの窓そのものと比べる。自動採番のIDだけ順番に置き換え、
// 題・説明・操作・属性・要素の順序は比較から外さない。
function dialogDOM() {
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')!.cloneNode(true) as HTMLElement
  const nodes = [dialog, ...dialog.querySelectorAll<HTMLElement>('*')]
  const ids = new Map(nodes.filter(node => node.id).map((node, index) => [node.id, `dialog-id-${index}`]))
  for (const node of nodes) for (const attribute of [...node.attributes]) {
    if (attribute.name === 'id' || attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
      node.setAttribute(attribute.name, attribute.value.split(' ').map(value => ids.get(value) ?? value).join(' '))
    }
  }
  return dialog.outerHTML
}

for (const withSave of [false, true]) it(`任意の口を省略したDOMは追加前と同じ（保存あり=${withSave}）`, () => {
  const onConfirm = vi.fn(), onCancel = vi.fn(), onSave = vi.fn(async () => true)
  const description = 'このまま移ると、入力した内容が消えます。'
  // 追加前の呼び出しをそのまま保存する。関数の中身はDOMには現れない。
  const legacy = render(withSave ? <Dialog open title="保存していない変更があります" description={description} busy={false} onCancel={onCancel} confirmation compact footer={
    <DialogActions>
      <Button variant="secondary" onClick={onConfirm} disabled={false}>保存せずに移る</Button>
      <Button variant="primary" onClick={() => void onSave()} disabled={false} lockedReason={undefined} busy={false} busyLabel="保存中…">保存して移る</Button>
    </DialogActions>
  } /> : <ConfirmDialog primaryAction="cancel" open title="保存していない変更があります" description={description} confirmLabel="保存せずに移る" cancelLabel="編集を続ける" busy={false} onConfirm={onConfirm} onCancel={onCancel} />)
  const expected = dialogDOM()
  legacy.unmount()
  render(<UnsavedLeaveDialog open onSave={withSave ? onSave : undefined} onConfirm={onConfirm} onCancel={onCancel} />)
  expect(dialogDOM()).toBe(expected)
})

it('保存成功は専用の移動だけを実行し、下書きを消す処理を通らない', async () => {
  const onSave = vi.fn(async () => true), onConfirm = vi.fn(), onSavedLeave = vi.fn(), onCancel = vi.fn()
  render(<UnsavedLeaveDialog open saveLabel="下書きを残して移る" discardLabel="下書きを消して移る" onSave={onSave} onSavedLeave={onSavedLeave} onConfirm={onConfirm} onCancel={onCancel} />)
  fireEvent.click(screen.getByRole('button', { name: '下書きを残して移る' }))
  await waitFor(() => expect(onSavedLeave).toHaveBeenCalledTimes(1))
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onConfirm).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
})

it('保存失敗時は専用の移動も破棄もせず、従来どおり編集へ戻る', async () => {
  const onSave = vi.fn(async () => false), onConfirm = vi.fn(), onSavedLeave = vi.fn(), onCancel = vi.fn()
  render(<UnsavedLeaveDialog open onSave={onSave} onSavedLeave={onSavedLeave} onConfirm={onConfirm} onCancel={onCancel} />)
  fireEvent.click(screen.getByRole('button', { name: '保存して移る' }))
  await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
  expect(onSavedLeave).not.toHaveBeenCalled()
  expect(onConfirm).not.toHaveBeenCalled()
})

for (const withSave of [false, true]) it(`破棄は元の処理へ届き、失敗は窓内に残り、理由を消せる（保存あり=${withSave}）`, () => {
  const onConfirm = vi.fn(), onSave = vi.fn(async () => true), onSavedLeave = vi.fn(), onCancel = vi.fn()
  const props = { open: true, discardLabel: '下書きを消して移る', onConfirm, onSave: withSave ? onSave : undefined, onSavedLeave, onCancel }
  const view = render(<UnsavedLeaveDialog {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '下書きを消して移る' }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
  expect(onSave).not.toHaveBeenCalled()
  expect(onSavedLeave).not.toHaveBeenCalled()
  view.rerender(<UnsavedLeaveDialog {...props} error="下書きを消せませんでした。もう一度お試しください。" />)
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement
  expect(within(dialog).getByRole('alert').textContent).toContain('下書きを消せませんでした')
  expect(onCancel).not.toHaveBeenCalled()
  view.rerender(<UnsavedLeaveDialog {...props} error={undefined} />)
  expect(within(dialog).queryByRole('alert')).toBeNull()
})

it('削除を待つ間は保存・破棄・×を使えず、終われば閉じられる', () => {
  const onConfirm = vi.fn(), onCancel = vi.fn(), onSave = vi.fn(async () => true)
  const props = { open: true, onConfirm, onCancel, onSave, saveLabel: '下書きを残して移る', discardLabel: '下書きを消して移る' }
  const view = render(<UnsavedLeaveDialog {...props} busy />)
  fireEvent.click(screen.getByRole('button', { name: '下書きを残して移る' }))
  fireEvent.click(screen.getByRole('button', { name: '下書きを消して移る' }))
  const close = screen.getByRole('button', { name: '閉じる' }) as HTMLButtonElement
  expect(close.disabled).toBe(true)
  fireEvent.click(close)
  expect(onConfirm).not.toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled(); expect(onCancel).not.toHaveBeenCalled()
  view.rerender(<UnsavedLeaveDialog {...props} busy={false} />)
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
})


for (const withSave of [false, true]) describe(`破棄の権限を保存と分ける（保存あり=${withSave}）`, () => {
  it('破棄だけのdisabledを保ち、保存・編集の継続を止めない', async () => {
    const onConfirm = vi.fn(), onCancel = vi.fn(), onSavedLeave = vi.fn(), onSave = vi.fn(async () => true)
    render(<UnsavedLeaveDialog open discardDisabled onSave={withSave ? onSave : undefined} onSavedLeave={onSavedLeave} onConfirm={onConfirm} onCancel={onCancel} />)
    const discard = screen.getByRole('button', { name: '保存せずに移る' }) as HTMLButtonElement
    expect(discard.disabled).toBe(true)
    fireEvent.click(discard)
    expect(onConfirm).not.toHaveBeenCalled()
    if (withSave) {
      fireEvent.click(screen.getByRole('button', { name: '保存して移る' }))
      await waitFor(() => expect(onSavedLeave).toHaveBeenCalledTimes(1))
      expect(onSave).toHaveBeenCalledTimes(1)
    } else {
      fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
      expect(onCancel).toHaveBeenCalledTimes(1)
    }
  })

  it('削除できない理由を焦点で伝え、クリックでは破棄しない', async () => {
    const onConfirm = vi.fn(), onSave = vi.fn(async () => true)
    render(<UnsavedLeaveDialog open discardLockedReason="下書きを削除する権限がありません。" onSave={withSave ? onSave : undefined} onConfirm={onConfirm} onCancel={vi.fn()} />)
    const discard = screen.getByRole('button', { name: '保存せずに移る' }) as HTMLButtonElement
    expect(discard.getAttribute('aria-disabled')).toBe('true')
    expect(discard.getAttribute('data-permission-locked')).not.toBeNull()
    expect(discard.disabled).toBe(false)
    fireEvent.focus(discard)
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('下書きを削除する権限がありません。'))
    fireEvent.click(discard)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('保持した古い破棄口も、後から付いた権限とbusyを守り、解除後は実行できる', async () => {
    fixture.discard = undefined
    const onConfirm = vi.fn(), onCancel = vi.fn(), onSave = vi.fn(async () => true)
    const props = { open: true, onSave: withSave ? onSave : undefined, onConfirm, onCancel }
    const view = render(<UnsavedLeaveDialog {...props} />)
    const held = fixture.discard
    expect(held).toBeTypeOf('function')
    view.rerender(<UnsavedLeaveDialog {...props} discardDisabled discardLockedReason="下書きを削除する権限がありません。" />)
    await act(async () => { held!() })
    expect(onConfirm).not.toHaveBeenCalled()
    view.rerender(<UnsavedLeaveDialog {...props} busy />)
    await act(async () => { held!() })
    expect(onConfirm).not.toHaveBeenCalled()
    view.rerender(<UnsavedLeaveDialog {...props} />)
    await act(async () => { fixture.discard!() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})

it('破棄が禁止でも保存成功後の従来の移動先は呼べる', async () => {
  const onConfirm = vi.fn(), onSave = vi.fn(async () => true)
  render(<UnsavedLeaveDialog open discardDisabled discardLockedReason="削除の権限がありません。" onSave={onSave} onConfirm={onConfirm} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '保存して移る' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  expect(onSave).toHaveBeenCalledTimes(1)
})
