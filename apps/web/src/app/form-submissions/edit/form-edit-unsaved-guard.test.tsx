// @vitest-environment happy-dom
/*
 * フォーム編集の「保存せずに移る」の試験（FORM-19a / FORM-19b / #1061）。
 *
 * 見る筋書き:
 *   1. 変更があるとき、一覧へのパンくず（回答フォーム）を押すと
 *      確認が出て、まだ移動しない（FORM-19a）。
 *   2. 「保存せずに移る」は移動と同時に、画面の入力を保存済みの状態へ戻す。
 *      同じページ内のクエリ遷移（タブ切替）でも同じ——コンポーネントが
 *      外れず画面が残るので、消えますと言った変更が残ってはいけない（FORM-19b）。
 *   3. 戻ったあとは未変更扱いになり、次の移動は確認なしで通る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiForm } from '@/lib/api'
import { screen, within, waitFor } from '@testing-library/react'
import { forgetCreatedFormDraft, readCreatedFormDraft, rememberCreatedFormDraft } from '@/lib/form-draft-session'
import { emptyLayout } from '@line-crm/shared'

const navigation = vi.hoisted(() => ({
  pathname: '/form-submissions/edit',
  query: 'id=form-1&tab=appearance',
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}))

const staffRole = vi.hoisted(() => ({ value: 'owner' }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => staffRole.value }))
vi.mock('@/lib/use-feature-access', async original => ({ ...await original<typeof import('@/lib/use-feature-access')>(), useFeatureAccess: () => true }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
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
    selectedAccountId: account.id,
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
const formsImpact = vi.hoisted(() => vi.fn())
const formsRemove = vi.hoisted(() => vi.fn())
const account = vi.hoisted(() => ({ id: 'acc-1' }))
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
      // 「予約を入れる」欄のメニュー・担当読み。予約を使わない店では空。
      // 素通しすると実通信で試験が環境へ依存するので、ここで空を返す。
      bookingApi: {
        ...actual.bookingApi,
        listMenus: async () => ({ menus: [] }),
        listMenuStaff: async () => ({ staff: [] }),
      },
      forms: {
        ...actual.api.forms,
        get: formsGet,
        update: formsUpdate, deleteImpact: formsImpact, remove: formsRemove,
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
// import より先に立てておく（vi.hoisted は import より先に評価される）。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

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
  window.history.replaceState(null, '', '/form-submissions/edit?id=form-1&tab=appearance')
  navigation.query = 'id=form-1&tab=appearance'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  formsGet.mockReset()
  formsUpdate.mockReset().mockResolvedValue({ success: true, data: { id: 'form-1', contentRevision: 2, updatedAt: '' } })
  formsImpact.mockReset().mockResolvedValue({ success: true, data: { canDelete: true, revision: 9, contentRevision: 1 } })
  formsRemove.mockReset().mockResolvedValue({ success: true, data: {} })
  navigation.push.mockClear()
  account.id = 'acc-1'
  staffRole.value = 'owner'
  forgetCreatedFormDraft('acc-1', 'form-1')
  forgetCreatedFormDraft('acc-2', 'form-1')
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  forgetCreatedFormDraft('acc-1', 'form-1')
  forgetCreatedFormDraft('acc-2', 'form-1')
})

async function show(over: Partial<ApiForm> = {}) {
  formsGet.mockResolvedValue({ success: true, data: { ...apiFormData, ...over } })
  await act(async () => { root.render(<EditFormPage />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function nameInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('#fe-name')
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
    await click(anchor('キャンセル'))
    expect(bodyText()).toContain('保存していない変更があります')
    expect(navigation.push).not.toHaveBeenCalled()
    // まだ画面に残っているので、書きかけの内容もそのまま。
    expect(nameInput().value).toBe('書きかけの名前')
  })

  it('「保存せずに移る」は入力を保存済みの状態へ戻してから移動する（FORM-19b）', async () => {
    await show()
    await editName('書きかけの名前')
    await click(anchor('キャンセル'))
    await click(dialogButton('保存せずに移る'))
    expect(navigation.push).toHaveBeenCalledWith('/form-submissions')
    // 移動が画面を外さない場合でも「消えます」と言った変更は戻っている。
    expect(nameInput().value).toBe('読み込んだフォーム名')
  })

  it('同じ編集ページのタブでは入力を保ち、その後の離脱では破棄して移動する（FORM-19b）', async () => {
    await show()
    await editName('書きかけの名前')
    const tab = [...host.querySelectorAll('[role="tab"]')].find((el) => el.textContent === '中身')!
    await click(tab)
    expect(bodyText()).not.toContain('保存していない変更があります')
    const appearance = [...host.querySelectorAll('[role="tab"]')].find((el) => el.textContent === '受付と見た目')!
    await click(appearance)
    expect(nameInput().value).toBe('書きかけの名前')
    await click(anchor('キャンセル'))
    expect(bodyText()).toContain('保存していない変更があります')
    await click(dialogButton('保存せずに移る'))
    expect(navigation.push).toHaveBeenCalledWith('/form-submissions')
    expect(nameInput().value).toBe('読み込んだフォーム名')
  })

  it('破棄したあとは未変更扱いになり、次の移動は確認なしで通る', async () => {
    await show()
    await editName('書きかけの名前')
    await click(anchor('キャンセル'))
    await click(dialogButton('保存せずに移る'))
    navigation.push.mockClear()
    // 捨て終わると未変更に戻るので、次のリンク押下は番兵が止めない
    // （止めない＝defaultPrevented されない＝そのまま遷移できる）。
    const event = await click(anchor('キャンセル'))
    expect(bodyText()).not.toContain('保存していない変更があります')
    expect(event.defaultPrevented).toBe(false)
  })

  it('「編集を続ける」は移動も破棄もしない', async () => {
    await show()
    await editName('書きかけの名前')
    await click(anchor('キャンセル'))
    await click(within(screen.getByRole('dialog', { name: '保存していない変更があります' })).getByRole('button', { name: '閉じる' }))
    expect(navigation.push).not.toHaveBeenCalled()
    expect(nameInput().value).toBe('書きかけの名前')
    expect(bodyText()).not.toContain('保存していない変更があります')
  })
})


describe('フォームを離れる時の保存と自動作成した下書き', () => {
  it('既存フォームは書きかけを保存してから移り、本体を消さない', async () => {
    await show(); await editName('保存して残す名前'); await click(anchor('キャンセル'))
    await click(dialogButton('下書きに保存して移る'))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/form-submissions'))
    expect(formsUpdate).toHaveBeenCalledWith('form-1', 'acc-1', expect.objectContaining({ name: '保存して残す名前', expectedContentRevision: 1 }))
    expect(nameInput().value).toBe('保存して残す名前')
    expect(formsRemove).not.toHaveBeenCalled()
  })
  it('保存できない時は移らず、書きかけの名前を残す', async () => {
    formsUpdate.mockRejectedValue(new Error('offline'))
    await show(); await editName('消さない名前'); await click(anchor('キャンセル'))
    await click(dialogButton('下書きに保存して移る'))
    await waitFor(() => expect(formsUpdate).toHaveBeenCalled())
    expect(navigation.push).not.toHaveBeenCalled()
    expect(nameInput().value).toBe('消さない名前')
    expect(formsRemove).not.toHaveBeenCalled()
  })
  it('自動作成直後は未変更でも残すか消すか聞き、確認した版で一度だけ消す', async () => {
    rememberCreatedFormDraft('acc-1', 'form-1', 1)
    await show(); await click(anchor('キャンセル'))
    expect(bodyText()).toContain('自動で作られた下書きがあります')
    const remove = dialogButton('下書きを消して移る')
    await act(async () => { remove.click(); remove.click() })
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/form-submissions'))
    expect(formsImpact).toHaveBeenCalledWith('form-1', 'acc-1')
    expect(formsRemove).toHaveBeenCalledTimes(1)
    expect(formsRemove).toHaveBeenCalledWith('form-1', 'acc-1', 9)
    expect(formsUpdate).not.toHaveBeenCalled()
    expect(readCreatedFormDraft('acc-1', 'form-1')).toBeNull()
  })
  it('下書きを残して移る時は保存成功を待ち、消す処理へ進まない', async () => {
    rememberCreatedFormDraft('acc-1', 'form-1', 1)
    let settle!: (value: unknown) => void
    formsUpdate.mockImplementationOnce(() => new Promise(done => { settle = done }))
    await show(); await editName('あとで続ける'); await click(anchor('キャンセル'))
    await click(dialogButton('下書きを残して移る'))
    expect(navigation.push).not.toHaveBeenCalled()
    await act(async () => settle({ success: true, data: { id: 'form-1', contentRevision: 2, updatedAt: '' } }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalled())
    expect(formsRemove).not.toHaveBeenCalled()
    expect(formsImpact).not.toHaveBeenCalled()
    expect(readCreatedFormDraft('acc-1', 'form-1')).toBeNull()
  })
  it.each([{ canDelete: false, contentRevision: 1 }, { canDelete: true, contentRevision: 2 }])('公開状態や版が変わった下書きは消さず、入力と確認を残す（%j）', async result => {
    rememberCreatedFormDraft('acc-1', 'form-1', 1)
    formsImpact.mockResolvedValue({ success: true, data: { ...result, revision: 10 } })
    await show(); await editName('まだ残す'); await click(anchor('キャンセル')); await click(dialogButton('下書きを消して移る'))
    expect(await screen.findByText(/下書きの状態が変わったため消せません/)).toBeTruthy()
    expect(formsRemove).not.toHaveBeenCalled()
    expect(navigation.push).not.toHaveBeenCalled()
    expect(nameInput().value).toBe('まだ残す')
  })
  it('削除の競合は窓内に理由を出し、成功した再試行では古い理由を消す', async () => {
    rememberCreatedFormDraft('acc-1', 'form-1', 1)
    formsRemove.mockRejectedValueOnce(new ApiError(409, 'changed'))
    await show(); await editName('書きかけ'); await click(anchor('キャンセル')); await click(dialogButton('下書きを消して移る'))
    const dialog = within(screen.getByRole('dialog', { name: '保存していない変更があります' }))
    expect(await dialog.findByText(/ほかの人が更新したため消せません/)).toBeTruthy()
    expect(nameInput().value).toBe('書きかけ')
    expect(navigation.push).not.toHaveBeenCalled()
    await click(dialogButton('下書きを消して移る'))
    await waitFor(() => expect(navigation.push).toHaveBeenCalled())
    expect(screen.queryByText(/ほかの人が更新したため消せません/)).toBeNull()
  })
  it('別の店へ切り替えた後に前の店の確認結果が届いても削除も移動もしない', async () => {
    rememberCreatedFormDraft('acc-1', 'form-1', 1)
    let settle!: (value: unknown) => void
    formsImpact.mockImplementationOnce(() => new Promise(done => { settle = done }))
    await show(); await click(anchor('キャンセル')); await click(dialogButton('下書きを消して移る'))
    account.id = 'acc-2'
    await act(async () => root.render(<EditFormPage />))
    await act(async () => settle({ success: true, data: { canDelete: true, revision: 9, contentRevision: 1 } }))
    expect(formsRemove).not.toHaveBeenCalled()
    expect(navigation.push).not.toHaveBeenCalled()
  })
})

it('編集できるスタッフにも消す操作は灰色と理由を出し、下書きを残す操作は使える', async () => {
  staffRole.value = 'staff'
  rememberCreatedFormDraft('acc-1', 'form-1', 1)
  await show(); await click(anchor('キャンセル'))
  const dialog = within(screen.getByRole('dialog', { name: '保存していない変更があります' }))
  const remove = dialog.getByRole('button', { name: '下書きを消して移る' })
  expect(remove.getAttribute('data-permission-locked')).not.toBeNull()
  const reason = remove.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)?.textContent).join(' ')
  expect(reason).toContain('オーナーか管理者')
  await click(remove)
  expect(formsRemove).not.toHaveBeenCalled()
  expect(formsImpact).not.toHaveBeenCalled()
  expect((dialog.getByRole('button', { name: '下書きを残して移る' }) as HTMLButtonElement).disabled).toBe(false)
  await click(dialogButton('下書きを残して移る'))
  await waitFor(() => expect(navigation.push).toHaveBeenCalled())
  expect(formsRemove).not.toHaveBeenCalled()
})
