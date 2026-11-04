// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity, readStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'

const net = vi.hoisted(() => ({ createDraft: vi.fn(), saveDraft: vi.fn(), conflicts: vi.fn(), publishDraft: vi.fn() }))
const auth = vi.hoisted(() => ({ me: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, autoReplies: { ...actual.api.autoReplies, ...net }, staff: { ...actual.api.staff, me: auth.me } } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
import QuickCreate from './quick-create'

const BOTH = '反応する言葉と返す文を入れてください。'
const WORD = '反応する言葉を1つ以上入れてください。'
const REPLY = '返す文を入れてください。'
const made = { success: true, data: { autoReplyId: 'fixture-draft', versionNumber: 1 } }
const callbacks = { onClose: vi.fn(), onCreated: vi.fn() }
const word = () => screen.getByLabelText('追加する言葉') as HTMLInputElement
const reply = () => screen.getByLabelText('返す文') as HTMLTextAreaElement
const save = () => screen.getByRole('button', { name: '有効にして保存' }) as HTMLButtonElement
const changeReply = (value: string) => fireEvent.change(reply(), { target: { value } })
function addWord(value = '営業時間') {
  fireEvent.change(word(), { target: { value } })
  fireEvent.keyDown(word(), { key: 'Enter' })
}
function blocked(reason: string) {
  expect(save().disabled).toBe(true)
  expect(save().dataset.variant).toBe('primary')
  expect(save().hasAttribute('data-permission-locked')).toBe(false)
  expect(save().getAttribute('aria-description')).toBe(reason)
  expect(screen.getAllByText(reason)).toHaveLength(1)
  expect(screen.getByText(reason).getAttribute('role')).toBe('status')
}
function available() {
  expect(save().disabled).toBe(false)
  expect(save().getAttribute('aria-description')).toBeNull()
  for (const reason of [BOTH, WORD, REPLY]) expect(screen.queryByText(reason)).toBeNull()
}
function noRequests() { for (const request of Object.values(net)) expect(request).not.toHaveBeenCalled() }
beforeEach(() => {
  verifiedStaffRole('owner'); forgetSessionSnapshot(); vi.clearAllMocks()
  document.documentElement.dataset.theme = 'v8'
  net.createDraft.mockReset().mockResolvedValue(made)
  net.saveDraft.mockReset().mockResolvedValue({ success: true, data: { autoReplyId: 'fixture-draft', versionNumber: 2 } })
  net.conflicts.mockReset().mockResolvedValue({ success: true, data: { conflicts: [] } })
  net.publishDraft.mockReset().mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot(); delete document.documentElement.dataset.theme })

it.each(['empty', 'spaces', 'only-word', 'only-reply', 'pending-spaces'])('%sの不足は主操作を止め、理由を1つだけ出し要求しない', async state => {
  render(<QuickCreate accountId="fixture-account" {...callbacks} />)
  if (state === 'spaces') { addWord('　 '); changeReply('　 ') }
  if (state === 'only-word') addWord()
  if (state === 'only-reply' || state === 'pending-spaces') changeReply('10時からです')
  if (state === 'pending-spaces') fireEvent.change(word(), { target: { value: '　 ' } })
  const reason = state === 'only-word' ? REPLY : state === 'only-reply' || state === 'pending-spaces' ? WORD : BOTH
  blocked(reason)
  await act(async () => { fireEvent.click(save()) })
  noRequests()
  expect(callbacks.onClose).not.toHaveBeenCalled(); expect(callbacks.onCreated).not.toHaveBeenCalled()
})

it('そろうと理由が消え、言葉や返す文を消すと不足の理由へ戻る', () => {
  render(<QuickCreate accountId="fixture-account" {...callbacks} />)
  addWord(); blocked(REPLY)
  changeReply('10時からです'); available()
  fireEvent.click(screen.getByRole('button', { name: '「営業時間」を外す' })); blocked(WORD)
  changeReply(''); blocked(BOTH)
  addWord(); changeReply('　 '); blocked(REPLY)
  changeReply('11時からです'); available()
  expect(reply().value).toBe('11時からです'); noRequests()
})

it('返信を先に入れた後の入力中の言葉を空扱いせず、IME確定・blur・既存保存の順を保つ', async () => {
  render(<QuickCreate accountId="fixture-account" {...callbacks} />)
  changeReply('10時からです'); blocked(WORD)
  fireEvent.change(word(), { target: { value: ' 営業時間 ' } }); available()
  fireEvent.keyDown(word(), { key: 'Enter', keyCode: 229 })
  expect(screen.queryByRole('button', { name: '「営業時間」を外す' })).toBeNull(); noRequests()
  fireEvent.blur(word())
  expect(word().value).toBe(''); expect(screen.getByRole('button', { name: '「営業時間」を外す' })).toBeTruthy(); available()
  await act(async () => { fireEvent.click(save()) })
  expect(net.createDraft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ keyword: '営業時間', keywords: [{ keyword: '営業時間', matchType: 'contains' }], responseContent: '10時からです', lineAccountId: 'fixture-account' }), expect.any(String))
  expect(net.conflicts).toHaveBeenCalledExactlyOnceWith('fixture-draft')
  expect(net.publishDraft).toHaveBeenCalledExactlyOnceWith('fixture-draft', { acknowledgedConflictIds: [] }, expect.any(String))
  expect(net.saveDraft).not.toHaveBeenCalled()
  expect(callbacks.onCreated).toHaveBeenCalledTimes(1); expect(callbacks.onClose).toHaveBeenCalledTimes(1)
})

it('入力中の言葉をEnterで札にしても、blurで重複させず有効のままにする', () => {
  render(<QuickCreate accountId="fixture-account" {...callbacks} />)
  changeReply('10時からです'); addWord(); fireEvent.blur(word())
  expect(screen.getAllByRole('button', { name: '「営業時間」を外す' })).toHaveLength(1)
  expect(word().value).toBe(''); available(); noRequests()
})

it('保存中は既存のbusyを保ち、入力不足の説明を重ねない', async () => {
  let resolve!: (value: typeof made) => void
  net.createDraft.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(<QuickCreate accountId="fixture-account" {...callbacks} />); addWord(); changeReply('10時からです')
  const button = save()
  await act(async () => { fireEvent.click(button) })
  expect(button.disabled).toBe(true); expect(button.getAttribute('aria-description')).toBeNull()
  expect(screen.queryByText(BOTH)).toBeNull(); expect(screen.queryByText(REPLY)).toBeNull()
  expect(net.createDraft).toHaveBeenCalledTimes(1); expect(net.publishDraft).not.toHaveBeenCalled()
  await act(async () => { resolve(made) })
  expect(net.publishDraft).toHaveBeenCalledTimes(1)
})

it.each(['unknown', 'viewer', 'read-proxy'])('%sの既存理由を優先し、入力不足の理由を重ねない', async kind => {
  render(<QuickCreate accountId="fixture-account" {...callbacks} />); blocked(BOTH)
  act(() => {
    if (kind === 'unknown') forgetStaffIdentity()
    else if (kind === 'viewer') rememberStaffIdentity({ ...readStaffIdentity()!, role: 'viewer', permissionKeys: [] })
    else rememberSessionSnapshot({ impersonation: { id: 'fixture-proxy', tenantId: 'fixture-tenant', mode: 'read', piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'none' })
  })
  for (const reason of [BOTH, WORD, REPLY]) expect(screen.queryByText(reason)).toBeNull()
  expect(save().getAttribute('aria-description')).toBeNull()
  if (kind === 'unknown') expect(save().disabled).toBe(true)
  else { expect(save().getAttribute('aria-disabled')).toBe('true'); expect(save().hasAttribute('data-permission-locked')).toBe(true) }
  await act(async () => { fireEvent.click(save()) }); noRequests()
})

it('アカウント切替後は既存の操作停止を保ち、入力不足とは説明しない', async () => {
  const { rerender } = render(<QuickCreate accountId="fixture-account" {...callbacks} />); blocked(BOTH)
  rerender(<QuickCreate accountId="another-fixture-account" {...callbacks} />)
  expect(save().disabled).toBe(true); expect(save().getAttribute('aria-description')).toBeNull()
  expect(screen.queryByText(BOTH)).toBeNull(); expect(screen.getByText('アカウントが切り替わりました。いったん閉じて作り直してください。')).toBeTruthy()
  await act(async () => { fireEvent.click(save()) }); noRequests()
})

it('入力理由は操作ボタンの並びの外にあり、ボタンは同じ組に置く', () => {
  render(<QuickCreate accountId="fixture-account" {...callbacks} />)
  expect(save().parentElement!.contains(screen.getByText(BOTH))).toBe(false)
  expect(save().parentElement).toBe(screen.getByRole('button', { name: 'キャンセル' }).parentElement)
  changeReply('10時からです'); addWord()
  expect(screen.queryByText(BOTH)).toBeNull()
})

it('返す文の欄を離れたとき、欄のエラーと帯の理由が同じ文になる', () => {
  render(<QuickCreate accountId="fixture-account" {...callbacks} />)
  addWord()
  fireEvent.blur(reply())
  expect(screen.getByRole('alert').textContent).toBe(REPLY)
  expect(screen.getByRole('status').textContent).toBe(REPLY)
})
