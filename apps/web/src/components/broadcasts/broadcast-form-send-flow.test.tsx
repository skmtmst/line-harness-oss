// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), send: vi.fn(), config: vi.fn(), request: vi.fn(), preflight: vi.fn(), success: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const empty = async () => ({ success: true, data: [] })
  return { ...actual, api: { ...actual.api,
    broadcasts: { ...actual.api.broadcasts, create: mocks.create, update: mocks.update, send: mocks.send, list: empty, preflight: mocks.preflight,
      approval: { config: mocks.config, request: mocks.request, candidates: async () => ({ success: true, data: [{ id: 'reviewer', name: '確認担当' }] }) } },
    folders: { list: empty }, scenarios: { list: empty }, commonVars: { list: empty }, friendFields: { list: empty },
    broadcastMessageAssets: { list: empty }, templates: { list: empty },
    commonActions: { resources: async () => ({ success: true, data: { commonActions: [] } }) },
    accountSettings: { getTestRecipients: empty },
  } }
})
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/broadcasts/new', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }) }))
import BroadcastForm from './broadcast-form'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }) }
function button(label: string, scope: ParentNode = document) {
  const element = Array.from(scope.querySelectorAll('button')).find((item) => item.textContent?.trim() === label)
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}
async function click(label: string, scope: ParentNode = document) { await act(async () => { fireEvent.click(button(label, scope)) }); await flush() }
async function render(step: 'confirm' | 'audience' = 'confirm', scheduled = false) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root.render(<BroadcastForm visualQaAugustCampaign initialScheduledDate={scheduled ? '2099-10-05' : undefined} initialScheduledTime={scheduled ? '10:00' : undefined} currentStep={step} tags={[{ id: 'exclude', name: '配信不要' } as never]} initialCondition={{ operator: 'OR', rules: [{ type: 'tag_exists', value: 'vip' }, { type: 'tag_exists', value: 'member' }] }} onSuccess={mocks.success} onCancel={() => {}} />) })
  await flush()
  await act(async () => { await vi.advanceTimersByTimeAsync(650) }); await flush()
}
async function confirm() { await click('今すぐ送る', container); return document.querySelector('[role="dialog"]')! }

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  mocks.create.mockResolvedValue({ success: true, data: { id: 'draft', version: 1 } })
  mocks.update.mockResolvedValue({ success: true, data: { id: 'draft', version: 2 } })
  mocks.send.mockResolvedValue({ success: true, data: { id: 'draft', status: 'sending' } })
  mocks.config.mockResolvedValue({ success: true, data: { threshold: 1000, singleOperator: false } })
  mocks.request.mockResolvedValue({ success: true, data: {} })
  mocks.preflight.mockResolvedValue({ success: true, data: { audienceCount: 10 } })
})
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); vi.useRealTimers() })

describe('V8の5手順で送信を確定する', () => {
  it('最終確認を開く段階では保存も送信もせず、窓の確定で1回だけ送る', async () => {
    await render(); const dialog = await confirm()
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(button('今すぐ送る', dialog)); fireEvent.click(button('今すぐ送る', dialog)) }); await flush()
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.send).toHaveBeenCalledExactlyOnceWith('draft', undefined)
    expect(mocks.success).toHaveBeenCalledWith({ id: 'draft', status: 'sending' })
  })
  it('送信が断られたときは入力と確認窓を残し、成功として移動しない', async () => {
    mocks.send.mockResolvedValue({ success: false, error: '送信枠が足りません' })
    await render(); const dialog = await confirm(); await click('今すぐ送る', dialog)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('送信枠が足りません')
    expect(container.textContent).toContain('8月キャンペーンのお知らせ'); expect(mocks.success).not.toHaveBeenCalled()
  })
  it('承認の設定を取得できないときは、送信確定の操作を出さない', async () => {
    mocks.config.mockResolvedValue({ success: false, error: '取得失敗' })
    await render(); const dialog = await confirm()
    expect(dialog.textContent).toContain('承認の設定を確認できません')
    expect(Array.from(dialog.querySelectorAll('button')).some((item) => item.textContent === '今すぐ送る')).toBe(false)
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled()
  })
  it('承認対象なら指定した人へ依頼し、即時送信しない', async () => {
    mocks.config.mockResolvedValue({ success: true, data: { threshold: 5, singleOperator: false } })
    await render(); const dialog = await confirm()
    await act(async () => { fireEvent.click(dialog.querySelector('button[aria-label="承認をお願いする人"]')!) }); await flush()
    await act(async () => { fireEvent.click(Array.from(document.querySelectorAll('[role="option"] button')).find((item) => item.textContent?.includes('確認担当'))!) }); await flush()
    await click('承認を依頼する', dialog)
    expect(mocks.request).toHaveBeenCalledWith('draft', { approverStaffId: 'reviewer', note: undefined })
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.success).toHaveBeenCalledTimes(1)
  })
  it('0人の条件では送信の確定を出さない', async () => {
    mocks.preflight.mockResolvedValue({ success: true, data: { audienceCount: 0 } })
    await render()
    expect(button('今すぐ送る', container).disabled).toBe(true)
    await click('今すぐ送る', container)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('予約の確定は日時を保存し、即時送信しない', async () => {
    await render('confirm', true)
    await click('この内容で予約する', container)
    await click('この内容で予約する', document.querySelector('[role="dialog"]')!)
    expect(mocks.create.mock.calls[0][0].scheduledAt).toBe('2099-10-05T01:00:00.000Z')
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.success).toHaveBeenCalledTimes(1)
  })
  it('1人運用では人数が合うまで保存せず、確認した人数を送信側にも渡す', async () => {
    mocks.config.mockResolvedValue({ success: true, data: { threshold: 5, singleOperator: true } })
    await render(); const dialog = await confirm()
    await click('今すぐ送る', dialog)
    expect(mocks.create).not.toHaveBeenCalled()
    await act(async () => { fireEvent.change(dialog.querySelector('input#approval-count')!, { target: { value: '10' } }) }); await flush()
    await click('今すぐ送る', dialog)
    expect(mocks.send).toHaveBeenCalledWith('draft', { confirmedRecipientCount: 10 })
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('ORの絞り込みへ除外タグを足しても、除外は必ずANDで効き、人数と保存は同じ条件になる', async () => {
    await render('audience')
    await act(async () => { fireEvent.click(container.querySelector('button[aria-label="除くタグ"]')!) }); await flush()
    await act(async () => { fireEvent.click(Array.from(document.querySelectorAll('[role="option"] button')).find((item) => item.textContent?.includes('配信不要'))!) }); await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(650) }); await flush()
    const counted = mocks.preflight.mock.calls.at(-1)![0].segmentConditions
    expect(counted).toMatchObject({ operator: 'AND', rules: [{ type: 'tag_not_exists', value: 'exclude' }], groups: [{ operator: 'AND', rules: [{ type: 'is_following', value: true }], groups: [{ operator: 'OR', rules: [{ type: 'tag_exists', value: 'vip' }, { type: 'tag_exists', value: 'member' }] }] }] })
    await click('下書きを保存する', container)
    expect(mocks.create.mock.calls[0][0].segmentConditions).toEqual(counted)
  })
})
