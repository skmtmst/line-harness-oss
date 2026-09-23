// @vitest-environment happy-dom
/*
 * フォーム編集の「保存せずに移動」の試験（FORM-19a / FORM-19b / #1061）。
 *
 * 見る筋書き:
 *   1. 変更があるとき、一覧へのパンくず（回答フォーム）を押すと
 *      確認が出て、まだ移動しない（FORM-19a）。
 *   2. 「保存せずに移動」は移動と同時に、画面の入力を保存済みの状態へ戻す。
 *      同じページ内のクエリ遷移（タブ切替）でも同じ——コンポーネントが
 *      外れず画面が残るので、消えますと言った変更が残ってはいけない（FORM-19b）。
 *   3. 戻ったあとは未変更扱いになり、次の移動は確認なしで通る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiForm } from '@/lib/api'
import { emptyLayout } from '@line-crm/shared'

const navigation = vi.hoisted(() => ({
  pathname: '/form-submissions/edit',
  query: 'id=form-1&tab=basic',
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
  useParams: () => ({}),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'acc-1', name: 'テスト店' }],
    selectedAccountId: 'acc-1',
    selectedAccount: { id: 'acc-1', name: 'テスト店' },
    loading: false,
    error: '',
    selectAccount: () => {},
    reloadAccounts: async () => {},
    canManage: true,
    role: 'admin',
  }),
}))

const formsGet = vi.hoisted(() => vi.fn())
const formsUpdate = vi.hoisted(() => vi.fn())
const emptyList = vi.hoisted(() => async () => ({ success: true, data: [] as never[] }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // ページは参照一覧を素の fetchApi で取る。通信が要ると試験が環境へ
    // 依存するので、ここで空の一覧を返す。
    fetchApi: vi.fn(async () => ({ success: true, data: [] })),
    api: {
      ...actual.api,
      forms: {
        ...actual.api.forms,
        get: formsGet,
        update: formsUpdate,
        publish: vi.fn(async () => ({ success: true, data: { id: 'v1' } })),
        submitCount: vi.fn(async () => ({ success: true, data: { count: 0 } })),
      },
      tags: { list: emptyList },
      friendFields: { list: emptyList },
      scenarios: { ...actual.api.scenarios, list: emptyList },
      reminders: { ...actual.api.reminders, list: emptyList },
      templates: { ...actual.api.templates, list: emptyList },
      formsShared: {
        options: vi.fn(async () => ({
          success: true,
          data: { userAttributes: [], tags: [], triggerScenarios: [], formRefs: [] },
        })),
      },
      publicFormSettings: { get: vi.fn(async () => ({ success: false })) },
      accounts: { list: emptyList },
      auth: { check: vi.fn(async () => ({ success: true })) },
    },
  }
})

// api.ts は読み込み時に NEXT_PUBLIC_API_URL を要求する。ページの
// import より先に立てておく（Vite はファイル順に評価する）。
process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'

import EditFormPage from './page'

const fixtureLayout = (() => {
  const layout = emptyLayout()
  layout.sections[0].name = 'ページ1'
  layout.sections[0].blocks = [
    { id: 'b1', kind: 'heading', text: 'アンケート' },
    { id: 'b2', kind: 'input', type: 'text', name: 'memo', label: 'ひとこと', required: false },
    { id: 'b3', kind: 'button', label: '送信する', url: '' },
  ] as never
  return layout
})()

const apiFormData = {
  id: 'form-1',
  lineAccountId: 'acc-1',
  name: '読み込んだフォーム名',
  description: '読み込んだ説明',
  isActive: 0,
  onSubmitTagId: null,
  layout: fixtureLayout,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  contentRevision: 1,
  publicSlug: 'form-1',
  urlKey: null,
  expiresAt: null,
  maxSubmissions: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState(null, '', '/form-submissions/edit?id=form-1&tab=basic')
  navigation.query = 'id=form-1&tab=basic'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  formsGet.mockReset()
  formsUpdate.mockReset()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function show(over: Partial<ApiForm> = {}) {
  formsGet.mockResolvedValue({ success: true, data: { ...apiFormData, ...over } })
  await act(async () => { root.render(<EditFormPage />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function nameInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('#fm-name')
  expect(input, 'フォーム名の欄がある').toBeTruthy()
  return input!
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function editName(next: string) {
  await act(async () => { setNativeValue(nameInput(), next) })
}

function anchor(text: string): HTMLAnchorElement {
  const found = [...host.querySelectorAll('a')].find((a) => a.textContent === text)
  expect(found, `リンク「${text}」がある`).toBeTruthy()
  return found!
}

async function click(target: Element): Promise<MouseEvent> {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  await act(async () => {
    target.dispatchEvent(event)
  })
  return event
}

// ConfirmDialog は portal で document.body 直下へ出る（host の外）。
function dialogButton(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label)
  expect(found, `ボタン「${label}」がある`).toBeTruthy()
  return found!
}

function bodyText(): string {
  return document.body.textContent ?? ''
}

describe('フォーム編集の未保存ガード（FORM-19）', () => {
  it('変更中に一覧のパンくずを押すと確認が出て、まだ移動しない（FORM-19a）', async () => {
    await show()
    await editName('書きかけの名前')
    await click(anchor('回答フォーム'))
    expect(bodyText()).toContain('保存していない変更があります')
    expect(navigation.push).not.toHaveBeenCalled()
    // まだ画面に残っているので、書きかけの内容もそのまま。
    expect(nameInput().value).toBe('書きかけの名前')
  })

  it('「保存せずに移動」は入力を保存済みの状態へ戻してから移動する（FORM-19b）', async () => {
    await show()
    await editName('書きかけの名前')
    await click(anchor('回答フォーム'))
    await click(dialogButton('保存せずに移動'))
    expect(navigation.push).toHaveBeenCalledWith('/form-submissions')
    // 移動が画面を外さない場合でも「消えます」と言った変更は戻っている。
    expect(nameInput().value).toBe('読み込んだフォーム名')
  })

  it('同じページ内のタブ移動でも、破棄してから移動する（FORM-19b）', async () => {
    await show()
    await editName('書きかけの名前')
    await click(anchor('デザイン設定'))
    expect(bodyText()).toContain('保存していない変更があります')
    await click(dialogButton('保存せずに移動'))
    expect(navigation.push).toHaveBeenCalledWith('/form-submissions/edit?id=form-1&tab=design')
    expect(nameInput().value).toBe('読み込んだフォーム名')
  })

  it('破棄したあとは未変更扱いになり、次の移動は確認なしで通る', async () => {
    await show()
    await editName('書きかけの名前')
    await click(anchor('回答フォーム'))
    await click(dialogButton('保存せずに移動'))
    navigation.push.mockClear()
    // 捨て終わると未変更に戻るので、次のリンク押下は番兵が止めない
    // （止めない＝defaultPrevented されない＝そのまま遷移できる）。
    const event = await click(anchor('回答フォーム'))
    expect(bodyText()).not.toContain('保存していない変更があります')
    expect(event.defaultPrevented).toBe(false)
  })

  it('「編集を続ける」は移動も破棄もしない', async () => {
    await show()
    await editName('書きかけの名前')
    await click(anchor('回答フォーム'))
    await click(dialogButton('編集を続ける'))
    expect(navigation.push).not.toHaveBeenCalled()
    expect(nameInput().value).toBe('書きかけの名前')
    expect(bodyText()).not.toContain('保存していない変更があります')
  })
})
