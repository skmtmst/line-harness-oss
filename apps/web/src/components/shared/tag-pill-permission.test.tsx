// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TagPill from './tag-pill'

afterEach(cleanup)
const reason = '閲覧のみのため外せません'

it('札と×を残し、焦点で理由を示して外す操作を止める。閲覧リンクは保つ', () => {
  const remove = vi.fn(), parent = vi.fn()
  const view = render(<div onClick={parent}><TagPill name="選択済み" href="/tags/edit?id=selected" onRemove={remove} lockedReason={reason} /></div>)
  const button = screen.getByRole('button', { name: '選択済みを外す' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  expect(button.tabIndex).toBe(0)
  expect(button.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(button)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.click(button)
  expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(false)
  expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false)
  expect(remove).not.toHaveBeenCalled()
  expect(parent).not.toHaveBeenCalled()
  expect(screen.getByRole('link').getAttribute('href')).toBe('/tags/edit?id=selected')
  view.rerender(<TagPill name="選択済み" onRemove={remove} />)
  fireEvent.click(screen.getByRole('button', { name: '選択済みを外す' }))
  expect(remove).toHaveBeenCalledTimes(1)
})

it('理由を指定しない既存の札・外す操作に権限の属性や説明を足さない', () => {
  const remove = vi.fn()
  const { container } = render(<><TagPill name="表示だけ" /><TagPill name="外せる" onRemove={remove} /></>)
  expect(container.querySelector('[data-permission-locked]')).toBeNull()
  expect(container.querySelector('[hidden]')).toBeNull()
  const button = screen.getByRole('button')
  expect(button.getAttribute('aria-describedby')).toBeNull()
  expect(button.hasAttribute('disabled')).toBe(false)
  fireEvent.click(button)
  expect(remove).toHaveBeenCalledExactlyOnceWith()
})
