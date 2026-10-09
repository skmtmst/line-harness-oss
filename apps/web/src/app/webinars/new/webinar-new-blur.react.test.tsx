// @vitest-environment happy-dom
/*
 * ウェビナー作成（V8）の「その場で確かめる入力」。
 * 保存を押す前に、欄を離れたとき（blur）に直し方を欄の下へ出す。
 * 文は保存時と同じ「何をすれば直るか」の1文。v7 は触らない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  create: vi.fn(),
  folders: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageCrumbs: () => undefined,
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      folders: fixture.folders,
      create: fixture.create,
    },
  }
})

/* 入口（page.tsx）は V8 のとき src/v8/webinar-edit/new を出す。この試験は今の作る画面（new-v8）の動きを見る。 */
import NewWebinarPage from './new-v8'

/* happy-dom に localStorage は無い。booking 配下と同じ memory stub を置く。 */
const localStorageValues = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
    removeItem: (key: string) => { localStorageValues.delete(key) },
    clear: () => { localStorageValues.clear() },
  },
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  fixture.create.mockReset()
  fixture.folders.mockReset()
  fixture.create.mockResolvedValue({ success: true, data: { id: 'new-webinar' } })
  fixture.folders.mockResolvedValue({ success: true, data: [] })
  window.localStorage.setItem('lh_staff_role', 'owner')
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  window.localStorage.clear()
  await act(async () => { root.unmount() })
  host.remove()
  document.documentElement.removeAttribute('data-theme')
})

async function render() {
  await act(async () => { root.render(<NewWebinarPage />) })
  await flush()
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function titleInput(): HTMLInputElement {
  const input = host.querySelector('#webinar-v8-title')
  if (!input) throw new Error('title input not found (v8)')
  return input as HTMLInputElement
}

function slugInput(): HTMLInputElement {
  const input = host.querySelector('#webinar-v8-slug')
  if (!input) throw new Error('slug input not found (v8)')
  return input as HTMLInputElement
}

describe('ウェビナー作成（V8）の欄を離れたときの確かめ', () => {
  it('空の名前欄を離れると保存前に欄の下へ直し方が出る', async () => {
    await render()

    await act(async () => { fireEvent.blur(titleInput()) })
    expect(host.textContent).toContain('ウェビナー名を入力してください')
    expect(fixture.create).not.toHaveBeenCalled()
  })

  it('決まりに合わないURLを離れると直し方が出て直すと消える', async () => {
    await render()

    await act(async () => { fireEvent.change(slugInput(), { target: { value: '日本語_URL' } }) })
    await act(async () => { fireEvent.blur(slugInput()) })
    expect(host.textContent).toContain('半角の英小文字・数字・-（ハイフン）だけで入力してください')

    await act(async () => { fireEvent.change(slugInput(), { target: { value: 'nen-start' } }) })
    expect(host.textContent).not.toContain('半角の英小文字・数字・-（ハイフン）だけで入力してください')
    expect(fixture.create).not.toHaveBeenCalled()
  })

  it('正しいURLのまま離れても何も出ない', async () => {
    await render()

    await act(async () => { fireEvent.change(slugInput(), { target: { value: 'nen-start' } }) })
    await act(async () => { fireEvent.blur(slugInput()) })
    expect(host.textContent).not.toContain('半角の英小文字')
  })
})
