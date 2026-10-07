// @vitest-environment happy-dom
/*
 * ★V8 左下の自分とメニュー（オーナー 2026-10-07・絵 V8.pen `zUg8S/T7XSI6/shBJJ`・`ZBjxY/Xn3xt`）。
 *
 *   - 押すと上に開くメニュー（読み上げ名「自分のメニュー」）。頭に名前と「役割・プランの一言」
 *   - 店の画面・オーナー/管理者：統括に戻る／メンバー／請求／お問い合わせ／ログアウト
 *   - 統括の画面：メンバー／請求／お問い合わせ／ログアウト（担当者には請求を出さない）
 *   - 店の画面・スタッフ/閲覧のみ：お問い合わせ／ログアウト
 *   - 統括に戻るは上の帯の切り替えと同じ（選んでいる店を外して /hq へ）
 *   - キーボード：開くと最初の行へ・矢印で移る・Esc で閉じて枠へ戻る・外を押すと閉じる
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  pathname: '/friends',
  push: vi.fn(),
  clearSelectedAccountId: vi.fn(),
  billingSummary: vi.fn(),
  logout: vi.fn(),
}))

const localStorageValues = new Map<string, string>()
const testLocalStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
  removeItem: (key: string) => { localStorageValues.delete(key) },
  clear: () => { localStorageValues.clear() },
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testLocalStorage })
Object.defineProperty(window, 'localStorage', { configurable: true, value: testLocalStorage })

vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname, useRouter: () => ({ push: fixture.push }) }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, prefetch: _prefetch, ...props }: { href: string; children: React.ReactNode; prefetch?: boolean }) =>
      React.createElement('a', { href, ...props }, children),
  }
})
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ clearSelectedAccountId: fixture.clearSelectedAccountId }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    hqBilling: { summary: fixture.billingSummary },
    staff: { me: vi.fn(async () => ({ success: false })) },
  },
}))
vi.mock('@/lib/logout', () => ({ logoutAndGoToLogin: fixture.logout }))

import { SidebarAccountMenu, sidebarAccountRows } from './account-menu'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function renderMenu(props: { hq?: boolean; collapsed?: boolean } = {}) {
  const view = render(<SidebarAccountMenu hq={props.hq ?? false} collapsed={props.collapsed} />)
  await act(async () => { await Promise.resolve() })
  return view
}

function trigger(view: ReturnType<typeof render>) {
  return view.getByRole('button', { name: /自分のメニュー/ })
}

async function openMenu(view: ReturnType<typeof render>) {
  fireEvent.click(trigger(view))
  await waitFor(() => expect(view.getByRole('menu', { name: '自分のメニュー' })).toBeTruthy())
  return view.getByRole('menu', { name: '自分のメニュー' })
}

function itemNames(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent?.trim())
}

describe('★V8 左下の自分とメニュー', () => {
  beforeEach(() => {
    fixture.pathname = '/friends'
    fixture.push.mockReset()
    fixture.clearSelectedAccountId.mockReset()
    fixture.logout.mockReset()
    fixture.billingSummary.mockReset()
    fixture.billingSummary.mockResolvedValue({ success: true, data: { state: 'trialing', trialDaysLeft: 14, planName: null } })
    localStorageValues.clear()
    window.localStorage.setItem('lh_staff_name', 'Kenta Kawano')
    window.localStorage.setItem('lh_staff_role', 'owner')
  })

  afterEach(() => {
    cleanup()
  })

  it('枠は顔・名前・役割。押すまでメニューは出ない', async () => {
    const view = await renderMenu()
    const button = trigger(view)
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).toContain('Kenta Kawano')
    expect(button.textContent).toContain('オーナー')
    expect(button.textContent).toContain('K')
    expect(view.queryByRole('menu')).toBeNull()
  })

  it('店の画面・オーナー：統括に戻る／メンバー／請求／お問い合わせ／ログアウト。頭は名前と「役割・プランの一言」', async () => {
    const view = await renderMenu()
    const menu = await openMenu(view)
    expect(trigger(view).getAttribute('aria-expanded')).toBe('true')
    expect(itemNames(menu)).toEqual(['統括に戻る', 'メンバー', '請求', 'お問い合わせ', 'ログアウト'])
    expect(menu.textContent).toContain('Kenta Kawano')
    await waitFor(() => expect(menu.textContent).toContain('オーナー・無料トライアル 残り14日'))
    const href = (name: string) => view.getByRole('menuitem', { name }).getAttribute('href')
    expect(href('メンバー')).toBe('/hq/members')
    expect(href('請求')).toBe('/hq/billing')
    expect(href('お問い合わせ')).toBe('/hq/support')
  })

  it('店の画面・管理者にも統括に戻るを出す（上の帯の切り替えと同じ判定）', async () => {
    window.localStorage.setItem('lh_staff_role', 'admin')
    const view = await renderMenu()
    const menu = await openMenu(view)
    expect(itemNames(menu)).toEqual(['統括に戻る', 'メンバー', '請求', 'お問い合わせ', 'ログアウト'])
    await waitFor(() => expect(menu.textContent).toContain('管理者・無料トライアル 残り14日'))
  })

  it('統括に戻るは、選んでいる店を外して /hq へ移り、メニューを閉じる', async () => {
    const view = await renderMenu()
    await openMenu(view)
    fireEvent.click(view.getByRole('menuitem', { name: '統括に戻る' }))
    expect(fixture.clearSelectedAccountId).toHaveBeenCalledTimes(1)
    expect(fixture.push).toHaveBeenCalledWith('/hq')
    await waitFor(() => expect(view.queryByRole('menu')).toBeNull())
  })

  it('統括の画面：メンバー／請求／お問い合わせ／ログアウト（統括に戻るは出さない）', async () => {
    fixture.pathname = '/hq'
    const view = await renderMenu({ hq: true })
    const menu = await openMenu(view)
    expect(itemNames(menu)).toEqual(['メンバー', '請求', 'お問い合わせ', 'ログアウト'])
  })

  it('統括の画面・担当者には請求を出さない', async () => {
    fixture.pathname = '/hq'
    window.localStorage.setItem('lh_staff_role', 'staff')
    const view = await renderMenu({ hq: true })
    const menu = await openMenu(view)
    expect(itemNames(menu)).toEqual(['メンバー', 'お問い合わせ', 'ログアウト'])
  })

  it.each([['staff', 'スタッフ'], ['viewer', '閲覧のみ']])('店の画面・%s：お問い合わせ／ログアウトだけ。プランは取りに行かない', async (role, label) => {
    window.localStorage.setItem('lh_staff_role', role)
    const view = await renderMenu()
    const menu = await openMenu(view)
    expect(itemNames(menu)).toEqual(['お問い合わせ', 'ログアウト'])
    expect(menu.textContent).toContain(label)
    expect(menu.textContent).not.toContain('無料トライアル')
    expect(fixture.billingSummary).not.toHaveBeenCalled()
  })

  it('プランが取れなくても役割だけで出す（メニューは壊れない）', async () => {
    fixture.billingSummary.mockRejectedValue(new Error('down'))
    const view = await renderMenu()
    const menu = await openMenu(view)
    expect(menu.textContent).toContain('オーナー')
    expect(menu.textContent).not.toContain('無料トライアル')
  })

  it('ログアウトは今のログアウト（logoutAndGoToLogin）を呼ぶ', async () => {
    const view = await renderMenu()
    await openMenu(view)
    fireEvent.click(view.getByRole('menuitem', { name: 'ログアウト' }))
    expect(fixture.logout).toHaveBeenCalledTimes(1)
  })

  it('キーボード：開くと最初の行へ・矢印で移る・Esc で閉じて枠へ戻る', async () => {
    const view = await renderMenu()
    const menu = await openMenu(view)
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(trigger(view))
    expect(trigger(view).getAttribute('aria-expanded')).toBe('false')
  })

  it('キーボード：枠で矢印を押しても開く', async () => {
    const view = await renderMenu()
    fireEvent.keyDown(trigger(view), { key: 'ArrowUp' })
    await waitFor(() => expect(view.getByRole('menu', { name: '自分のメニュー' })).toBeTruthy())
  })

  it('外を押すと閉じる。もう一度枠を押しても閉じる', async () => {
    const view = await renderMenu()
    await openMenu(view)
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(view.queryByRole('menu')).toBeNull())
    await openMenu(view)
    fireEvent.click(trigger(view))
    await waitFor(() => expect(view.queryByRole('menu')).toBeNull())
  })

  it('畳んだ左メニューでは顔だけの形（名前は title で読める）', async () => {
    const view = await renderMenu({ collapsed: true })
    const root = view.container.querySelector('[data-design-node="shBJJ"]')
    expect(root?.hasAttribute('data-collapsed')).toBe(true)
    expect(trigger(view).getAttribute('title')).toBe('Kenta Kawano')
    cleanup()
    const open = await renderMenu()
    expect(open.container.querySelector('[data-design-node="shBJJ"]')?.hasAttribute('data-collapsed')).toBe(false)
  })
})

describe('左下の自分のメニューの行の出し分け', () => {
  it('役割と画面で行が決まる', () => {
    expect(sidebarAccountRows({ hq: false, role: 'owner', canReturnToHq: true })).toEqual(['hq', 'members', 'billing', 'support', 'logout'])
    expect(sidebarAccountRows({ hq: false, role: 'admin', canReturnToHq: true })).toEqual(['hq', 'members', 'billing', 'support', 'logout'])
    expect(sidebarAccountRows({ hq: true, role: 'owner', canReturnToHq: false })).toEqual(['members', 'billing', 'support', 'logout'])
    expect(sidebarAccountRows({ hq: true, role: 'staff', canReturnToHq: false })).toEqual(['members', 'support', 'logout'])
    expect(sidebarAccountRows({ hq: false, role: 'staff', canReturnToHq: false })).toEqual(['support', 'logout'])
    expect(sidebarAccountRows({ hq: false, role: 'viewer', canReturnToHq: false })).toEqual(['support', 'logout'])
  })
})
