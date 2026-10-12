// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PageExplanationBody, PageExplanationProvider, PageExplanationToggle } from './page-explanation'

const staff = vi.hoisted(() => ({ id: 'staff-one' }))
vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => staff }))
const stored = new Map<string, string>()
const browserStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
}
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
function Screen({ pageKey = 'scenarios' }: { pageKey?: string }) {
  return <PageExplanationProvider pageKey={pageKey}>
    <PageExplanationToggle />
    <PageExplanationBody>配信を始める前にテストを送ります。</PageExplanationBody>
  </PageExplanationProvider>
}
beforeEach(() => {
  staff.id = 'staff-one'
  stored.clear()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: browserStorage })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
})

it('初めは開き、閉じた状態を同じ人の同じ画面だけで覚える', () => {
  const view = render(<Screen />)
  const toggle = () => screen.getByRole('button', { name: 'この画面の説明' })
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('region').id).toBe(toggle().getAttribute('aria-controls'))
  fireEvent.click(toggle())
  expect(screen.queryByRole('region')).toBeNull()
  view.unmount()
  const next = render(<Screen />)
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  next.rerender(<Screen pageKey="tags" />)
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  next.rerender(<Screen />)
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
})

it('人が変わると前の人の開閉を引き継がず、戻るとその人の状態へ戻る', () => {
  const view = render(<Screen />)
  fireEvent.click(screen.getByRole('button', { name: 'この画面の説明' }))
  staff.id = 'staff-two'
  view.rerender(<Screen />)
  expect(screen.getByRole('region').textContent).toContain('テストを送ります')
  staff.id = 'staff-one'
  view.rerender(<Screen />)
  expect(screen.queryByRole('region')).toBeNull()
})

it('保存領域が使えない端末でもその場の開閉はできる', () => {
  vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') })
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
  render(<Screen />)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  fireEvent.click(toggle)
  expect(screen.queryByRole('region')).toBeNull()
  fireEvent.click(toggle)
  expect(screen.getByRole('region')).toBeTruthy()
})
