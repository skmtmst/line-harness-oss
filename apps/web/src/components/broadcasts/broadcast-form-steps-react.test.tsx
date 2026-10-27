// @vitest-environment happy-dom
/*
 * 一斉配信の作成画面の段（設計 `LMiL2`）と、段ごとの案内を本物の画面で確かめる。
 *
 * 見る筋書き:
 *   1. 5段の帯を描き、いまいる段を帯の上でも示す。段の飛び先の節が画面に実在する。
 *   2. 配信名のそばに「n / 60文字」を出す（設計 `zZ9fA`）。
 *   3. 日時を指定したときだけ、送信直前に数え直して人数が増減しうることを書く（設計 `Bw0zt`）。
 *   4. 配信前チェックの窓（設計 `vW4Es`）は、数えた人数だけを出し、未取得なら未取得と書く。
 *   5. 撮影用アカウントでは、最終確認を「8月キャンペーン」の完成状態に固定できる。
 *      （配信後のアクションの初期値は、アカウントを読んだ時点で空に戻るので、画面では見えない。）
 */
import { setTextControlValue } from '@/test-utils/text-control'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { broadcastSteps, type BroadcastStepKey } from './broadcast-steps'
import { TITLE_MAX } from './broadcast-form-model'

const mocks = vi.hoisted(() => ({ preflight: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const empty = async () => ({ success: true, data: [] })
  return { ...actual, api: { ...actual.api,
    broadcasts: { ...actual.api.broadcasts, create: vi.fn(async () => ({ success: true, data: { id: 'draft', version: 1 } })), update: vi.fn(), get: vi.fn(), list: empty, preflight: mocks.preflight,
      approval: { config: async () => ({ success: true, data: { threshold: 1000, singleOperator: false } }), request: vi.fn(), candidates: empty } },
    folders: { list: empty }, scenarios: { list: empty }, commonVars: { list: empty }, friendFields: { list: empty },
    broadcastMessageAssets: { list: empty }, templates: { list: empty },
    commonActions: { resources: async () => ({ success: true, data: { commonActions: [] } }) },
    accountSettings: { getTestRecipients: async () => ({ success: true, data: [{ id: 'r1', displayName: '担当A' }, { id: 'r2', displayName: '担当B' }] }) },
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
function buttons(label: string) { return Array.from(document.querySelectorAll('button')).filter((item) => item.textContent?.trim() === label) }

type RenderOptions = { step?: BroadcastStepKey | null; scheduled?: boolean; filled?: boolean }
async function render({ step = 'basic', scheduled = false, filled = true }: RenderOptions = {}) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => {
    root.render(<BroadcastForm
      visualQaAugustCampaign={filled}
      initialScheduledDate={scheduled ? '2099-10-05' : undefined}
      initialScheduledTime={scheduled ? '10:00' : undefined}
      currentStep={step ?? undefined}
      tags={[]}
      initialCondition={{ operator: 'OR', rules: [{ type: 'tag_exists', value: 'vip' }] }}
      onSuccess={() => {}}
      onCancel={() => {}}
    />)
  })
  await flush()
  await act(async () => { await vi.advanceTimersByTimeAsync(650) }); await flush()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  mocks.preflight.mockResolvedValue({ success: true, data: { audienceCount: 37, hiddenExcluded: 0, warnings: [] } })
})
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); vi.clearAllMocks(); vi.useRealTimers() })

describe('作成画面の5段の帯（設計 LMiL2）', () => {
  it('帯を描き、いまいる段を帯の上でも示す', async () => {
    await render({ step: 'audience' })
    const band = container.querySelector('nav[aria-label="配信作成の進み"]')
    expect(band).not.toBeNull()
    expect(band!.querySelectorAll('li')).toHaveLength(5)
    expect(band!.querySelector('li[data-step-state="current"]')?.textContent).toContain('配信対象')
  })

  it('段の飛び先の id を持つ節が、作成画面に実在する', async () => {
    await render({ step: null })
    const anchors = broadcastSteps({ basicDone: false, audienceDone: false, messageDone: false, scheduleDone: false }).map((step) => step.anchor)
    expect(anchors).toHaveLength(5)
    expect(anchors.filter((anchor) => !document.getElementById(anchor))).toEqual([])
  })
})

describe('配信名の字数（設計 zZ9fA）', () => {
  it('入力欄のそばに「n / 60文字」を出し、打つと数え直す', async () => {
    await render({ filled: false })
    expect(container.textContent).toContain(`0 / ${TITLE_MAX}文字`)
    const title = container.querySelector('input[placeholder="例：8月キャンペーンのお知らせ"]') as HTMLInputElement
    await act(async () => { setTextControlValue(title, '秋の案内') })
    expect(container.textContent).toContain(`4 / ${TITLE_MAX}文字`)
  })
})

describe('予約の注意書き（設計 Bw0zt）', () => {
  it('日時を指定したときだけ、送信直前に数え直し人数が増減しうることを書く', async () => {
    await render({ step: 'schedule', scheduled: true })
    const section = container.querySelector('#broadcast-step-schedule')!
    expect(section.textContent).toContain('もう一度対象を数え直してから送ります')
    expect(section.textContent).toContain('いま出ている人数から増減することがあります')
    act(() => root.unmount()); container.remove()

    await render({ step: 'schedule', scheduled: false })
    expect(container.querySelector('#broadcast-step-schedule')!.textContent).not.toContain('もう一度対象を数え直してから送ります')
  })
})

describe('配信前チェックの窓（設計 vW4Es）', () => {
  async function openPreflightDialog() {
    await act(async () => { fireEvent.click(buttons('配信前チェックを確認')[0]) }); await flush()
    const dialog = document.querySelector<HTMLElement>('[data-design-node="vW4Es"] [role="dialog"]')
    if (!dialog) throw new Error('配信前チェックの窓（vW4Es）が開いていない')
    return dialog
  }

  it('数えた人数を確かめる項目として出す', async () => {
    await render({ step: 'confirm' })
    const dialog = await openPreflightDialog()
    expect(dialog.textContent).toContain('対象人数 37人を確認してください')
    expect(dialog.textContent).not.toContain('対象人数をまだ取得できていません')
  })

  it('数えられていないときは、確認したとは書かず未取得と書く', async () => {
    mocks.preflight.mockRejectedValue(new Error('500'))
    await render({ step: 'confirm' })
    const dialog = await openPreflightDialog()
    expect(dialog.textContent).toContain('対象人数をまだ取得できていません')
    expect(dialog.textContent).not.toMatch(/対象人数 [\d,]+人を確認してください/)
  })
})

describe('撮影用の完成状態', () => {
  it('配信名・テスト送信の結果が埋まった状態で開く', async () => {
    await render({ step: null })
    const title = container.querySelector('input[placeholder="例：8月キャンペーンのお知らせ"]') as HTMLInputElement
    expect(title.value).toBe('8月キャンペーンのお知らせ')
    await act(async () => { fireEvent.click(buttons('テストを送る').at(-1)!) }); await flush()
    // テスト送信の窓（設計 h0kahp）は宛先を選ばせない。題も「テストを送る」。
    const dialog = document.querySelector('[data-design-node="h0kahp"] [role="dialog"]')!
    expect(dialog.querySelector('h2, [id$="title"]')?.textContent ?? dialog.textContent).toContain('テストを送る')
    expect(dialog.textContent).not.toContain('テスト送信先を選択')
    expect(dialog.textContent).toContain('テスト送信しました（2件）')
  })

  it('撮影用でなければ、配信名もテスト送信の結果も空で開く', async () => {
    await render({ step: null, filled: false })
    const title = container.querySelector('input[placeholder="例：8月キャンペーンのお知らせ"]') as HTMLInputElement
    expect(title.value).toBe('')
    expect(document.body.textContent).not.toContain('テスト送信しました（2件）')
  })
})
