// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Toggle, { ToggleField, ToggleGroupActions } from './toggle'
import { Field } from './form-controls'
import { PERMISSION_LOCK_REASON } from './permission-lock'

afterEach(cleanup)

it.each([true, false])('権限ロックは値%sを保ち、焦点・マウス・タップで理由を伝え、変更も親操作も起動しない', checked => {
  const change = vi.fn(), parent = vi.fn(), submit = vi.fn((event: { preventDefault(): void }) => event.preventDefault())
  render(<form onSubmit={submit}><div onClick={parent}><Toggle checked={checked} disabled lockedReason={PERMISSION_LOCK_REASON.viewer} label="通知を使う" onChange={change} /></div></form>)
  const control = screen.getByRole('switch', { name: '通知を使う' }) as HTMLButtonElement
  expect(control.disabled).toBe(false)
  expect(control.getAttribute('aria-disabled')).toBe('true')
  expect(control.getAttribute('aria-checked')).toBe(String(checked))
  expect(control.hasAttribute('data-permission-locked')).toBe(true)
  expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe(PERMISSION_LOCK_REASON.viewer)
  fireEvent.pointerEnter(control, { pointerType: 'mouse' })
  expect(screen.getByRole('tooltip').textContent).toBe(PERMISSION_LOCK_REASON.viewer)
  fireEvent.pointerLeave(control, { pointerType: 'mouse' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  act(() => control.focus())
  expect(document.activeElement).toBe(control)
  expect(screen.getByRole('tooltip').textContent).toBe(PERMISSION_LOCK_REASON.viewer)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.pointerDown(control, { pointerType: 'touch' })
  expect(screen.getByRole('tooltip').textContent).toBe(PERMISSION_LOCK_REASON.viewer)
  expect(fireEvent.keyDown(control, { key: 'Enter' })).toBe(false)
  expect(fireEvent.keyDown(control, { key: ' ' })).toBe(false)
  fireEvent.click(control)
  fireEvent.doubleClick(control)
  expect(change).not.toHaveBeenCalled()
  expect(parent).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
})

it('説明とラベルを保ち、権限が戻ったら一度だけ変更できる', () => {
  const change = vi.fn()
  const control = (reason?: string) => <Field label="通知" note="保存するまで反映されません"><ToggleField checked description="前日に送ります" lockedReason={reason} onChange={change}>通知を使う</ToggleField></Field>
  const { rerender } = render(control(PERMISSION_LOCK_REASON.manager))
  const toggle = screen.getByRole('switch', { name: '通知を使う' })
  const descriptions = toggle.getAttribute('aria-describedby')!.split(/\s+/).map(id => document.getElementById(id)?.textContent)
  expect(descriptions).toEqual(expect.arrayContaining(['保存するまで反映されません', '前日に送ります', PERMISSION_LOCK_REASON.manager]))
  fireEvent.click(screen.getByText('通知を使う'))
  expect(change).not.toHaveBeenCalled()
  rerender(control())
  fireEvent.click(screen.getByText('通知を使う'))
  expect(change.mock.calls).toEqual([[false]])
})

it('権限ロックの一括操作は両方の入口を残し、件数と共通理由を保って変更しない', () => {
  const change = vi.fn()
  render(<ToggleGroupActions total={6} enabled={4} label="配信" disabled lockedReason={PERMISSION_LOCK_REASON.manager} onChange={change} />)
  const controls = screen.getAllByRole('button') as HTMLButtonElement[]
  expect(controls).toHaveLength(2)
  for (const button of controls) {
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const descriptions = button.getAttribute('aria-describedby')!.split(/\s+/).map(id => document.getElementById(id)?.textContent)
    expect(descriptions).toEqual(expect.arrayContaining(['6 件中 4 件オン', PERMISSION_LOCK_REASON.manager]))
    fireEvent.click(button)
  }
  expect(change).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
})
