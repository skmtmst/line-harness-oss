// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Tr, Td } from './table'
import ActionMenu from './action-menu'
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
afterEach(cleanup)
test('名前以外を押しても同じ詳細リンクを開き、チェック操作は移動しない', () => {
  const navigate = vi.fn(), toggle = vi.fn()
  render(<table><tbody><Tr><Td><a href="/detail?id=1" onClick={e => { e.preventDefault(); navigate() }}>名前</a></Td><Td>ほかの欄</Td><Td><button onClick={toggle}>選ぶ</button></Td></Tr></tbody></table>)
  fireEvent.click(screen.getByText('ほかの欄'))
  expect(navigate).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '選ぶ' }))
  expect(toggle).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledTimes(1)
})
test('external のメニューは実際のリンクで新しいタブを開く', () => {
  const select = vi.fn()
  render(<ActionMenu open inline items={[{ id: 'detail', label: '詳細', href: '/detail', external: true, onSelect: select }]} onClose={() => {}} />)
  const link = screen.getByRole('menuitem', { name: '詳細' })
  expect(link.tagName).toBe('A')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toContain('noopener')
  fireEvent.click(link)
  expect(select).not.toHaveBeenCalled()
})
