// @vitest-environment happy-dom
/*
 * N-113 ウェビナーの申込フォームを選ぶ欄（CTA・フォームの段）を描いて押す。
 * 同じアカウントの公開中フォームだけを候補にし、読込中・0件・取得失敗・権限不足を分ける。
 * 選んだフォームは版付きの editor 口へ registrationFormId として送り、開き直しで戻す。
 * 止まった・別アカウントのフォームで断られたら理由を出して候補を取り直す。CTA のフォームとは混ぜない。
 */
import { findPickerDialog, pickEntity } from '@/components/shared/entity-picker-test-helpers'
import { fireEvent, screen, within } from '@testing-library/react'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ editor: vi.fn(), ctas: vi.fn(), saveCtas: vi.fn(), saveEditor: vi.fn(), fetchApi: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, fetchApi: apiMocks.fetchApi, webinarApi: { editor: apiMocks.editor, ctas: apiMocks.ctas, saveCtas: apiMocks.saveCtas, saveEditor: apiMocks.saveEditor } }
})
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())

import CtaPane from '@/v8/webinar-edit/cta'
import { webinarEditContext, webinarWizardChrome } from '@/test-utils/webinar-edit'
import { ApiError, type Webinar, type WebinarEditor } from '@/lib/api'

const EDITOR = { version: 5, registrationFormId: null, publicPage: { form: null } } as unknown as WebinarEditor
const FORMS = [
  { id: 'form-1', name: '申込フォーム', isActive: true },
  { id: 'form-2', name: '相談フォーム', isActive: true },
  { id: 'form-off', name: '止めたフォーム', isActive: false },
]

const roots: Root[] = []
let save: (() => Promise<boolean>) | null = null
function render(editor: WebinarEditor = EDITOR, overrides: Parameters<typeof webinarEditContext>[2] = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  const onEditorChange = vi.fn()
  act(() => {
    root.render(
      <CtaPane
        ctx={webinarEditContext({ id: 'webinar-1', accountId: 'account-1', durationSeconds: 3600 } as Webinar, editor, { onEditorChange, ...overrides })}
        chrome={webinarWizardChrome}
        onDirtyChange={() => {}}
        registerSave={(handler) => { save = handler }}
      />,
    )
  })
  return { host, onEditorChange }
}
const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve() })

beforeEach(() => {
  vi.resetAllMocks()
  save = null
  apiMocks.ctas.mockResolvedValue({ data: [] })
  apiMocks.saveCtas.mockResolvedValue({ data: [] })
  apiMocks.saveEditor.mockResolvedValue({ data: { ...EDITOR, version: 6, registrationFormId: 'form-1' } })
  apiMocks.fetchApi.mockResolvedValue({ success: true, data: FORMS })
})
afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount() })
  document.body.innerHTML = ''
})

it('このウェビナーのアカウントのフォームだけを読み、公開中だけを候補に出す', async () => {
  render()
  await settle()
  expect(apiMocks.fetchApi).toHaveBeenCalledWith('/api/forms?account_id=account-1')
  fireEvent.click(await screen.findByRole('button', { name: /^申込に使う回答フォーム/ }))
  const dialog = await findPickerDialog()
  expect(within(dialog).queryByRole('radio', { name: '申込フォーム' })).not.toBeNull()
  expect(within(dialog).queryByRole('radio', { name: '止めたフォーム' })).toBeNull()
})

it('読込中・0件・取得失敗・権限不足を言い分け、失敗は読み直せる', async () => {
  const pending = Promise.withResolvers<unknown>()
  apiMocks.fetchApi.mockReturnValueOnce(pending.promise)
  const first = render()
  await settle()
  expect(first.host.textContent).toContain('回答フォームを読み込んでいます。')
  await act(async () => { pending.resolve({ success: true, data: [FORMS[2]] }) })
  expect(first.host.textContent).toContain('公開中の回答フォームがありません。')

  apiMocks.fetchApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'))
  const forbidden = render()
  await settle()
  expect(forbidden.host.textContent).toContain('この操作の権限がありません')
  expect(forbidden.host.textContent).not.toContain('回答フォームを読み込めませんでした。')

  apiMocks.fetchApi.mockRejectedValueOnce(new ApiError(500, 'boom'))
  const failed = render()
  await settle()
  expect(failed.host.textContent).toContain('回答フォームを読み込めませんでした。')
  const calls = apiMocks.fetchApi.mock.calls.length
  await act(async () => { within(failed.host).getByRole('button', { name: 'もう一度読み込む' }).click() })
  await settle()
  expect(apiMocks.fetchApi.mock.calls.length).toBe(calls + 1)
  expect(failed.host.textContent).not.toContain('回答フォームを読み込めませんでした。')
})

it('選んだフォームを版付きで registrationFormId として保存し、親の版を更新する', async () => {
  const { onEditorChange } = render()
  await settle()
  await pickEntity('申込に使う回答フォーム', '申込フォーム')
  await act(async () => { expect(await save!()).toBe(true) })
  expect(apiMocks.saveEditor).toHaveBeenCalledWith('webinar-1', { expectedVersion: 5, registrationFormId: 'form-1' })
  expect(onEditorChange).toHaveBeenCalledWith(expect.objectContaining({ version: 6, registrationFormId: 'form-1' }))
})

it('開き直したときは保存済みのフォームを選んだ形で出す', async () => {
  const { host } = render({ ...EDITOR, registrationFormId: 'form-2' } as WebinarEditor)
  await settle()
  expect(host.querySelector('button[aria-label^="申込に使う回答フォーム"]')?.parentElement?.textContent).toContain('相談フォーム')
})

it('続けて保存を押しても editor の保存は1回だけ', async () => {
  const pending = Promise.withResolvers<{ data: WebinarEditor }>()
  apiMocks.saveEditor.mockReturnValueOnce(pending.promise)
  render()
  await settle()
  await pickEntity('申込に使う回答フォーム', '申込フォーム')
  let first!: Promise<boolean>
  await act(async () => { first = save!(); void save!() })
  await act(async () => { pending.resolve({ data: { ...EDITOR, version: 6 } as WebinarEditor }); await first })
  expect(apiMocks.saveEditor).toHaveBeenCalledTimes(1)
})

it.each([
  ['form_inactive_or_missing', 'フォームが無効か見つかりません。'],
  ['form_account_mismatch', '別のアカウントのフォームは使えません。'],
])('%s で断られたら理由を出し、候補を取り直す', async (code, reason) => {
  apiMocks.saveEditor.mockRejectedValueOnce(new ApiError(400, 'rejected', code))
  const { host } = render()
  await settle()
  await pickEntity('申込に使う回答フォーム', '申込フォーム')
  const reads = apiMocks.fetchApi.mock.calls.length
  await act(async () => { expect(await save!()).toBe(false) })
  await settle()
  expect(apiMocks.fetchApi.mock.calls.length).toBe(reads + 1)
  expect([...host.querySelectorAll('[role="alert"]')].some((alert) => alert.textContent?.includes(reason))).toBe(true)
})

it('前に選んだフォームが止まっていたら選び直しを促し、その選択では送らない', async () => {
  const { host } = render({ ...EDITOR, registrationFormId: 'form-off' } as WebinarEditor)
  await settle()
  const alert = [...host.querySelectorAll('[role="alert"]')].find((element) => element.textContent?.includes('前に選んだフォームは使えなくなりました'))
  expect(alert?.textContent).toBe('前に選んだフォームは使えなくなりました。公開中のフォームを選び直してください。')
  await act(async () => { await save!() })
  expect(apiMocks.saveEditor).not.toHaveBeenCalled()
})

it('閲覧のみでは、保存済みの公開フォームの名前を読むだけにする', async () => {
  const { host } = render({ ...EDITOR, registrationFormId: 'form-1', publicPage: { form: { name: '公開中の申込フォーム' } } } as unknown as WebinarEditor, { readOnly: true })
  await settle()
  expect(host.textContent).toContain('公開中の申込フォーム')
  expect(host.querySelector('button[aria-label^="申込に使う回答フォーム"]')).toBeNull()
})

it('CTA カードのフォームと申込のフォームは別々に保存する', async () => {
  apiMocks.ctas.mockResolvedValue({ data: [{ atSeconds: 600, kind: 'form', title: '診断', body: null, buttonLabel: '受ける', autoOpen: false, formId: 'form-1', url: null }] })
  render()
  await settle()
  await pickEntity('申込に使う回答フォーム', '相談フォーム')
  await act(async () => { expect(await save!()).toBe(true) })
  expect(apiMocks.saveEditor).toHaveBeenCalledWith('webinar-1', expect.objectContaining({ registrationFormId: 'form-2' }))
  expect(apiMocks.saveCtas).toHaveBeenCalledWith('webinar-1', [expect.objectContaining({ kind: 'form', formId: 'form-1' })])
  expect(screen.getByRole('heading', { name: '申込に使う回答フォーム' }).id).toBe('webinar-regform-title')
})
