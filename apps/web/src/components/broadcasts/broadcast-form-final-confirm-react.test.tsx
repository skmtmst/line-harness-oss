// @vitest-environment happy-dom
/*
 * 一斉配信の最終確認（設計 `FpgxH` 6-1-H ／ IDEA-06）を、本物の作成画面で押して確かめる。
 *
 * 見る筋書き:
 *   1. 予約は確認の窓を通す。下書き保存は窓を通さずに保存する。窓を開く前に入力の不備で止める。
 *   2. 人数は配信前チェックが数えた数だけを使い、未取得は「—」。数えられていなければ送らせない。
 *   3. 画面内の最終確認と確認の窓に、対象・除外・配信日時・送信枠・計算時刻・重複配信を並べる。
 *   4. 条件が変わったら古い確認を使わない。遅れて届いた古い応答で新しい確認を上書きしない。
 *   5. 送っているあいだは確定を押せない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { formatDateTime } from '@/lib/format'
import type { BroadcastPreflight } from '@/lib/api'

const mocks = vi.hoisted(() => ({ get: vi.fn(), preview: vi.fn(), confirm: vi.fn(), create: vi.fn(), update: vi.fn(), send: vi.fn(), config: vi.fn(), request: vi.fn(), preflight: vi.fn(), success: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const empty = async () => ({ success: true, data: [] })
  return { ...actual, api: { ...actual.api,
    broadcasts: { ...actual.api.broadcasts, get: mocks.get, create: mocks.create, update: mocks.update, send: mocks.send, list: empty, preflight: mocks.preflight,
      approval: { config: mocks.config, request: mocks.request, candidates: async () => ({ success: true, data: [] }) } },
    folders: { list: empty }, scenarios: { list: empty }, commonVars: { list: empty }, friendFields: { list: empty },
    broadcastMessageAssets: { list: empty }, templates: { list: empty },
    commonActions: { resources: async () => ({ success: true, data: { commonActions: [] } }) },
    accountSettings: { getTestRecipients: empty },
  } }
})
vi.mock('@/lib/api/helpers/gap1', () => ({ chatSafetyApi: { sendPreview: mocks.preview, confirmBroadcast: mocks.confirm } }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/broadcasts/new', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }) }))
import BroadcastForm from './broadcast-form'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EVALUATED_AT = '2099-10-05T00:30:00.000Z'
const PREFLIGHT = {
  audienceCount: 37,
  hiddenExcluded: 0,
  warnings: [],
  quota: { state: 'available', monthlyUsed: 100, monthlyLimit: 1000, remaining: 900, planned: 37, reason: null },
  audience: { matched: 37, sendable: 37, evaluatedAt: EVALUATED_AT, representatives: [] },
  concurrentBroadcasts: [{ id: 'other', title: '別の秋の配信', scheduledAt: '2099-10-05T01:30:00.000Z' }],
} satisfies BroadcastPreflight

let root: Root
let container: HTMLDivElement
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }) }
async function settle(ms = 650) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }); await flush() }
function findButton(label: string, scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll('button')).find((item) => item.textContent?.trim() === label)
}
function button(label: string, scope: ParentNode = document) {
  const element = findButton(label, scope)
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}
async function click(label: string, scope: ParentNode = document) { await act(async () => { fireEvent.click(button(label, scope)) }); await flush() }
function dialog() { return document.querySelector<HTMLElement>('[role="dialog"]') }
/** 定義の並び（dt → dd）を表にする。 */
function definitions(scope: ParentNode): Record<string, string> {
  return Object.fromEntries(Array.from(scope.querySelectorAll('dt')).map((dt) => [dt.textContent?.trim() ?? '', dt.nextElementSibling?.textContent?.trim() ?? '']))
}

type RenderOptions = { step?: 'confirm' | 'audience' | null; scheduled?: boolean; filled?: boolean }
async function render({ step = 'confirm', scheduled = false, filled = true }: RenderOptions = {}) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => {
    root.render(<BroadcastForm
      visualQaAugustCampaign={filled}
      initialScheduledDate={scheduled ? '2099-10-05' : undefined}
      initialScheduledTime={scheduled ? '10:00' : undefined}
      currentStep={step ?? undefined}
      tags={[{ id: 'exclude', name: '配信不要' } as never]}
      initialCondition={{ operator: 'OR', rules: [{ type: 'tag_exists', value: 'vip' }] }}
      onSuccess={mocks.success}
      onCancel={() => {}}
    />)
  })
  await flush()
  await settle()
}

/** 1人運用の店で、人数を打ち込んで確かめる窓（確認の中身をすべて並べる窓）を開く。 */
async function openSingleOperatorDialog() {
  mocks.config.mockResolvedValue({ success: true, data: { threshold: 5, singleOperator: true } })
  await render()
  await click('今すぐ送る', container)
  await settle(200)
  const opened = dialog()
  if (!opened) throw new Error('確認の窓が開いていない')
  return opened
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  mocks.get.mockResolvedValue({ success: true, data: { id: 'draft', version: 2, status: 'sending' } })
  mocks.create.mockResolvedValue({ success: true, data: { id: 'draft', version: 1 } })
  mocks.update.mockResolvedValue({ success: true, data: { id: 'draft', version: 2 } })
  mocks.send.mockResolvedValue({ success: true, data: { id: 'draft', status: 'sending' } })
  mocks.config.mockResolvedValue({ success: true, data: { threshold: 1000, singleOperator: false } })
  mocks.request.mockResolvedValue({ success: true, data: {} })
  mocks.preflight.mockResolvedValue({ success: true, data: PREFLIGHT })
  mocks.preview.mockResolvedValue({ success: true, data: { recipients: 37, excluded: { blocked: 0, optedOut: 0, duplicate: 0, hidden: 0, missingDestination: 0 }, purpose: 'marketing', scheduledAt: null, quietHoursShiftTo: null, needsApproval: false, firstText: '本文', sender: null, expectedVersion: 2 } })
  mocks.confirm.mockResolvedValue({ success: true, data: {} })
})
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); vi.useRealTimers() })

describe('予約は確認を通し、下書き保存は通さない（段の無い作成画面）', () => {
  it('「配信を予約する」は保存せずに確認の窓を開く', async () => {
    await render({ step: null, scheduled: true })
    await click('配信を予約する', container)
    expect(dialog()).not.toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('「下書きを保存する」は窓を開かずにそのまま保存する', async () => {
    await render({ step: null })
    await click('下書きを保存する', container)
    expect(dialog()).toBeNull()
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('入力に不備があるときは窓を開く前に止め、理由を出す', async () => {
    await render({ step: null, scheduled: true, filled: false })
    await click('配信を予約する', container)
    expect(dialog()).toBeNull()
    expect(container.querySelector('[role="alert"], .text-danger')).not.toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('人数は配信前チェックが数えた数だけを使う', () => {
  it('対象の段の人数は配信前チェックの数を出す', async () => {
    await render({ step: 'audience' })
    expect(container.textContent).toContain('この条件で送る人数37人')
  })

  it('数えられていないときは送らせず、人数を「—」で出す（0人と書かない）', async () => {
    mocks.preflight.mockRejectedValue(new Error('500'))
    await render()
    expect(button('今すぐ送る', container).disabled).toBe(true)
    expect(container.textContent).toContain('人数を確認してから送れます')
    const inPage = definitions(container.querySelector('#broadcast-step-confirm details')!)
    expect(inPage['対象']).toMatch(/—$/)
    expect(inPage['対象']).not.toContain('0人')
  })
})

describe('確認の窓に並べるもの', () => {
  it('対象・除外・送信枠・計算時刻・配信日時・送る中身を、配信前チェックの値で並べる', async () => {
    const opened = await openSingleOperatorDialog()
    const rows = definitions(opened)
    expect(Object.keys(rows)).toEqual(expect.arrayContaining(['配信対象', '除外', '送信枠', '計算時刻', '配信日時', '送る中身']))
    expect(rows['配信対象']).toContain('37人')
    expect(rows['送信枠']).toBe('残り 900 / 1,000通（この配信で 37通を使用）')
    // 表示側で今の時刻を作らない。配信前チェックが数えた時刻だけを出す。
    expect(rows['計算時刻']).toBe(formatDateTime(EVALUATED_AT))
    expect(rows['配信日時']).toBe('今すぐ（確認してから送信）')
    // 除外の数としての口が無い応答では、0人と書かずに理由を出す。
    expect(rows['除外']).toContain('除外した人数はまだ取れません')
  })

  it('把握できる重複配信を窓にも出す', async () => {
    const opened = await openSingleOperatorDialog()
    expect(opened.textContent).toContain('同じ時刻の前後1時間に別の予約配信があります')
    expect(opened.textContent).toContain('別の秋の配信')
  })

  it('送っているあいだは確定を押せない', async () => {
    let finish!: (value: unknown) => void
    mocks.send.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const opened = await openSingleOperatorDialog()
    await act(async () => { fireEvent.change(opened.querySelector('input#approval-count')!, { target: { value: '37' } }) }); await flush()
    await act(async () => { fireEvent.click(button('今すぐ送る', opened)) }); await flush()
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(opened.getAttribute('aria-busy')).toBe('true')
    // 確定も戻るも押せない（二重に送らない・送っている途中で窓を閉じない）。
    expect(findButton('今すぐ送る', opened)?.disabled ?? true).toBe(true)
    expect(button('戻って修正', opened).disabled).toBe(true)
    await act(async () => { finish({ success: true, data: { id: 'draft', status: 'sending' } }) }); await flush()
  })
})

describe('画面内の最終確認（IDEA-06）', () => {
  it('内訳に対象・除外・配信日時・送信枠・計算時刻を並べる', async () => {
    await render()
    const rows = definitions(container.querySelector('#broadcast-step-confirm details')!)
    expect(rows['対象']).toContain('37人')
    expect(rows['除外']).toBe('—')
    expect(rows['配信日時']).toBe('今すぐ（確認してから送信）')
    expect(rows['送信枠']).toBe('残り 900 / 1,000通（この配信で 37通を使用）')
    expect(rows['計算時刻']).toBe(formatDateTime(EVALUATED_AT))
  })

  it('送信枠が取れない・足りないときは、0や空白で誤魔化さずに分けて出す', async () => {
    mocks.preflight.mockResolvedValue({ success: true, data: { ...PREFLIGHT, quota: { ...PREFLIGHT.quota, state: 'unavailable' } } })
    await render()
    expect(definitions(container.querySelector('#broadcast-step-confirm details')!)['送信枠']).toBe('確認できませんでした')
    act(() => root.unmount()); container.remove()

    mocks.preflight.mockResolvedValue({ success: true, data: { ...PREFLIGHT, quota: { ...PREFLIGHT.quota, state: 'insufficient', remaining: 10 } } })
    await render()
    expect(definitions(container.querySelector('#broadcast-step-confirm details')!)['送信枠']).toBe('不足しています（残り 10 / 1,000通）')
  })

  it('把握できる重複配信を画面内にも出す', async () => {
    await render()
    const section = container.querySelector('#broadcast-step-confirm')!
    expect(section.textContent).toContain('同じ時刻の前後1時間に別の予約配信があります')
    expect(section.textContent).toContain('別の秋の配信')
  })
})

describe('条件が変わったら古い確認を使わない', () => {
  async function addExcludeTag() {
    await act(async () => { fireEvent.click(container.querySelector('button[aria-label="除くタグ"]')!) }); await flush()
    await act(async () => { fireEvent.click(Array.from(document.querySelectorAll('input[type="radio"]')).find((item) => item.getAttribute('aria-label')?.includes('配信不要'))!) }); await flush()
    await click('選ぶ', [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!)
  }

  it('条件を変えた直後は、前の条件で数えた人数を出さない', async () => {
    await render({ step: 'audience' })
    expect(container.textContent).toContain('この条件で送る人数37人')
    mocks.preflight.mockImplementation(() => new Promise(() => {}))
    await addExcludeTag()
    expect(container.textContent).not.toContain('37人')
  })

  it('遅れて届いた古い応答で、新しい条件の人数を上書きしない', async () => {
    let finishOld!: (value: unknown) => void
    mocks.preflight.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    await render({ step: 'audience' })
    mocks.preflight.mockResolvedValue({ success: true, data: { ...PREFLIGHT, audienceCount: 20 } })
    await addExcludeTag()
    await settle()
    expect(container.textContent).toContain('この条件で送る人数20人')
    await act(async () => { finishOld({ success: true, data: { ...PREFLIGHT, audienceCount: 99 } }) }); await flush()
    expect(container.textContent).toContain('この条件で送る人数20人')
    expect(container.textContent).not.toContain('99人')
  })
})
