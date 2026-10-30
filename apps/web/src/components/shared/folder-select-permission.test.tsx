// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import FolderSelect from './folder-select'

const reason = '閲覧のみのため変更できません。オーナーか管理者に頼んでください。'
const folders = [{ value: 'follow', label: '来店後', color: '#117755' }, { value: 'renew', label: '更新前', color: '#553311' }]
afterEach(cleanup)

it('理由未指定と明示undefinedでDOM・Tab・通常の候補選択を変えない', () => {
  const change = vi.fn(), props = { folders, value: 'follow', onChange: change, 'aria-label': '置き場' }
  const view = render(<FolderSelect {...props} />)
  const original = view.container.innerHTML
  const trigger = screen.getByRole('button', { name: '置き場' })
  expect(trigger.tabIndex).toBe(0)
  view.rerender(<FolderSelect {...props} lockedReason={undefined} />)
  expect(view.container.innerHTML).toBe(original)
  fireEvent.click(trigger)
  fireEvent.click(within(screen.getByRole('option', { name: '更新前' })).getByRole('button'))
  expect(change).toHaveBeenCalledExactlyOnceWith('renew')
})

it('理由付きでも色と値を残し、灰色の欄へTabで届き、開く・選ぶを拒否する', () => {
  const change = vi.fn()
  render(<FolderSelect folders={folders} value="follow" onChange={change} aria-label="置き場" disabled lockedReason={reason} />)
  const trigger = screen.getByRole('button', { name: '置き場' })
  expect(trigger.textContent).toContain('来店後')
  expect(trigger.querySelector('[data-folder-dot]')).toBeTruthy()
  expect(trigger.hasAttribute('disabled')).toBe(false)
  expect(trigger.getAttribute('aria-disabled')).toBe('true')
  expect(trigger.hasAttribute('data-permission-locked')).toBe(true)
  expect(trigger.tabIndex).toBe(0)
  fireEvent.focus(trigger)
  expect(screen.getAllByRole('tooltip')).toHaveLength(1)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.click(trigger); fireEvent.keyDown(trigger, { key: 'ArrowDown' }); fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(change).not.toHaveBeenCalled()
})

it('開いてからロックすると欄の値は残り、保持した候補の確定でも変更0、解除後の明示選択だけ1', () => {
  const change = vi.fn(), props = { folders, value: 'follow', onChange: change, 'aria-label': '置き場' }
  const view = render(<FolderSelect {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '置き場' }))
  const option = within(screen.getByRole('option', { name: '更新前' })).getByRole('button')
  const key = Object.keys(option).find(key => key.startsWith('__reactProps$'))!
  const choose = (option as unknown as Record<string, { onClick: (event: unknown) => void }>)[key].onClick
  expect(choose).toBeTypeOf('function')
  view.rerender(<FolderSelect {...props} lockedReason={reason} />)
  choose({ preventDefault() {}, stopPropagation() {}, defaultPrevented: false })
  expect(change).not.toHaveBeenCalled()
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.getByRole('button', { name: '置き場' }).textContent).toContain('来店後')
  view.rerender(<FolderSelect {...props} />)
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '置き場' }))
  fireEvent.click(within(screen.getByRole('option', { name: '更新前' })).getByRole('button'))
  expect(change).toHaveBeenCalledExactlyOnceWith('renew')
})

it('本人未知の理由なしdisabledへ権限の印や吹き出しを足さない', () => {
  render(<FolderSelect folders={folders} value="follow" onChange={vi.fn()} aria-label="置き場" disabled />)
  const trigger = screen.getByRole('button', { name: '置き場' })
  expect(trigger.hasAttribute('disabled')).toBe(true)
  expect(trigger.hasAttribute('data-permission-locked')).toBe(false)
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(trigger.textContent).toContain('来店後')
})
