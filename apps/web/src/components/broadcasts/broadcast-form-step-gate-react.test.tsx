// @vitest-environment happy-dom
/*
 * 一斉配信の作成：段ごとの確かめが通るまで［次へ］を押せない（SPEC-2）。
 *
 * 見る筋書き:
 *   - 段ごとの不備で［次へ］が押せず、押せない理由が下の帯の左に1行で出る
 *   - 直すと押せて、次の段へ進む
 *   - 「N/5」が今の段（URL の ?step=）と一致する
 *   - 先へ進むのだけ止める不備（過ぎた予約日時）では下書きの保存を止めない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const createApi = vi.hoisted(() => vi.fn())
const updateApi = vi.hoisted(() => vi.fn())
const getApi = vi.hoisted(() => vi.fn())
const onStepChange = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const emptyList = async () => ({ success: true, data: [] })
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        create: createApi,
        update: updateApi,
        get: getApi,
        list: async () => ({ success: true, data: [] }),
        preflight: async () => ({ success: true, data: { audienceCount: 10 } }),
        previewCount: async () => ({ success: true, data: { count: 10 } }),
      },
      folders: { list: emptyList },
      scenarios: { list: emptyList },
      commonVars: { list: emptyList },
      friendFields: { list: emptyList },
      broadcastMessageAssets: { list: emptyList, upload: emptyList },
      templates: { list: emptyList },
      commonActions: { resources: async () => ({ success: true, data: [] }) },
      accountSettings: { getTestRecipients: async () => ({ success: true, data: [] }) },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/broadcasts/new',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import BroadcastForm from './broadcast-form'
import type { BroadcastStepKey } from './broadcast-steps'
import { PageChromeProvider } from '@/components/shell/page-chrome'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve()
  })
}

async function renderForm(step: BroadcastStepKey | null, extra: Partial<React.ComponentProps<typeof BroadcastForm>> = {}) {
  document.title = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <PageChromeProvider><BroadcastForm
        tags={[]}
        onSuccess={() => {}}
        onCancel={() => {}}
        currentStep={step}
        onStepChange={onStepChange}
        {...extra}
      /></PageChromeProvider>,
    )
  })
  await flush()
}

function unmount() {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
}

/** 下の帯のボタン。隠れた段の「送信設定へ戻る」などと取り違えない。 */
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('[data-shared-part="sticky-bar"] button')].find((item) => (item.textContent ?? '').includes(label))
  if (!found) throw new Error(`${label} のボタンがありません`)
  return found as HTMLButtonElement
}

/** 下の帯の左に出る、押せない理由の1行。 */
function footerReason(): string | null {
  return container.querySelector('[data-shared-part="sticky-bar"] [data-sticky-lead] p')?.textContent ?? null
}

function stepCount(): string | null {
  return container.querySelector('[data-step-count]')?.textContent ?? null
}

async function typeTitle(value: string) {
  const title = container.querySelector<HTMLInputElement>('input[placeholder="例：8月キャンペーンのお知らせ"]')
  if (!title) throw new Error('配信名の欄がありません')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(title, value)
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

describe('段ごとの確かめで［次へ］を止める', () => {
  it.each(['basic', 'audience', 'message', 'schedule', 'confirm'] as const)('%sでも作成画面の題と手順を同じ枠で表示する', async (step) => {
    await renderForm(step)
    try {
      expect(container.querySelector('[data-page-template="create"]')).toBeTruthy()
      expect(container.querySelector('h2')?.textContent).toBe('一斉配信を作る')
      expect(document.title).toBe('一斉配信を作る | musubo')
      expect(container.querySelector('[aria-label="配信作成の進み"]')).toBeTruthy()
      if (step === 'basic') {
        const memoLabel = container.querySelector('textarea[aria-label="社内メモ"]')?.closest('label')
        expect(memoLabel?.querySelector('span')?.textContent).toContain('社内メモ')
        expect(memoLabel?.querySelector('span')?.textContent).toContain('任意')
        expect(memoLabel?.querySelector('[aria-hidden="true"]')?.textContent).toBe('任意')
      }
    } finally {
      unmount()
    }
  })

  it('手順のない埋め込みは作成画面の枠を足さない', async () => {
    await renderForm(null)
    try {
      expect(container.querySelector('[data-page-template="create"]')).toBeNull()
      expect(container.querySelector('h2')?.textContent).toBe('一斉配信を作る')
    } finally {
      unmount()
    }
  })

  it('テンプレートを選ぶ間も通常の画面名を保つ', async () => {
    await renderForm('message', { openTemplatePickerInitially: true })
    try {
      expect([...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.textContent?.includes('テンプレートを選ぶ'))).toBe(true)
      expect(document.title).toBe('一斉配信を作る | musubo')
      expect(createApi).not.toHaveBeenCalled()
      expect(updateApi).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it('配信前チェックを開くと専用の画面名へ切り替わる', async () => {
    await renderForm('confirm')
    try {
      const open = [...container.querySelectorAll('button')].find(item => item.textContent === '配信前チェックを確認')
      expect(open).toBeTruthy()
      await click(open as HTMLButtonElement)
      expect(document.title).toBe('一斉配信の配信前チェック | musubo')
      expect(createApi).not.toHaveBeenCalled()
      expect(updateApi).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it('配信名が空のうちは基本の段の［次へ］を押せず、理由を帯の左に出す。入れると押せる', async () => {
    await renderForm('basic')
    try {
      expect(stepCount()).toBe('1/5 基本設定')
      expect(button('対象設定へ').disabled).toBe(true)
      expect(footerReason()).toBe('配信名を入力してください')
      // 読み上げでも理由が分かるよう、ボタンから理由の1行へ結び付ける。
      expect(document.getElementById(button('対象設定へ').getAttribute('aria-describedby') ?? '')?.textContent).toBe('配信名を入力してください')
      await click(button('対象設定へ'))
      expect(onStepChange).not.toHaveBeenCalled()

      await typeTitle('秋のお知らせ')
      expect(button('対象設定へ').disabled).toBe(false)
      expect(footerReason()).toBeNull()
      await click(button('対象設定へ'))
      expect(onStepChange).toHaveBeenCalledWith('audience')
    } finally {
      unmount()
    }
  })

  it('下書きの保存も、帯と同じ理由で止める（帯は通るのに保存で断られる、を作らない）', async () => {
    await renderForm('basic')
    try {
      expect(footerReason()).toBe('配信名を入力してください')
      await click(button('下書きを保存する'))
      expect(createApi).not.toHaveBeenCalled()
      expect(container.textContent).toContain('配信名を入力してください')
    } finally {
      unmount()
    }
  })

  it('新規の宛先は未選択で、選ぶまで次へ進めず理由を出す', async () => {
    await renderForm('audience', { visualQaAugustCampaign: true })
    try {
      expect(container.querySelectorAll('input[name="broadcast-target-mode"]:checked')).toHaveLength(0)
      expect(button('メッセージ設定へ').disabled).toBe(true)
      expect(footerReason()).toBe('送る相手を選んでください')
      await click(button('メッセージ設定へ'))
      expect(onStepChange).not.toHaveBeenCalled()
    } finally { unmount() }
  })

  it('宛先の条件が空のときは宛先の段の［次へ］を押せない（絞ったつもりで全員に届くのを防ぐ）', async () => {
    await renderForm('audience', { visualQaAugustCampaign: true, initialCondition: { operator: 'AND', rules: [] } })
    try {
      expect(stepCount()).toBe('2/5 配信対象')
      expect(button('メッセージ設定へ').disabled).toBe(true)
      expect(footerReason()).toContain('詳細条件を1つ以上入力してください')
    } finally {
      unmount()
    }
  })

  it('吹き出しが空のときは中身の段の［次へ］を押せない', async () => {
    await renderForm('message')
    try {
      expect(stepCount()).toBe('3/5 メッセージを作成')
      expect(button('送信設定へ').disabled).toBe(true)
      expect(footerReason()).toBeTruthy()
    } finally {
      unmount()
    }
  })

  it('予約の日時が過ぎていると送信設定の段の［次へ］を押せないが、下書きの保存は通る', async () => {
    createApi.mockResolvedValue({ success: true, data: { id: 'bc-1', version: 1, status: 'draft', title: '8月キャンペーンのお知らせ' } })
    await renderForm('schedule', { visualQaAugustCampaign: true, initialScheduledDate: '2020-01-01', initialScheduledTime: '10:00' })
    try {
      expect(stepCount()).toBe('4/5 送信設定')
      expect(button('配信前チェックへ').disabled).toBe(true)
      expect(footerReason()).toBe('予約の日時が過ぎています。今より後の日時にしてください')
      await click(button('下書きを保存する'))
      expect(createApi).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })

  it('新規の送信設定は未選択で始まり、選ぶまで次へ進まず理由を表示する', async () => {
    await renderForm('schedule', { visualQaAugustCampaign: true })
    try {
      const schedule = container.querySelector('#broadcast-step-schedule')!
      expect(schedule.querySelectorAll('[role="radio"][aria-checked="true"], input[type="radio"]:checked').length).toBe(0)
      expect(button('配信前チェックへ').disabled).toBe(true)
      expect(footerReason()).toBe('送る時間を選んでください')
      await click(button('配信前チェックへ'))
      expect(onStepChange).not.toHaveBeenCalled()
      expect(createApi).not.toHaveBeenCalled()
      expect(updateApi).not.toHaveBeenCalled()
    } finally { unmount() }
  })

  it('分散を選ぶと開始日時と分数を1か所で決められ、開始を決めるまで進めない', async () => {
    await renderForm('schedule', { visualQaAugustCampaign: true })
    try {
      const schedule = container.querySelector('#broadcast-step-schedule')!
      const spread = schedule.querySelector<HTMLInputElement>('input[type="radio"][value="spread"]')
        ?? schedule.querySelector<HTMLButtonElement>('[role="radio"][value="spread"]')
      expect(spread).toBeTruthy()
      await click(spread!)
      expect(schedule.querySelector('[aria-label="配信日（日本時間）"]')).toBeTruthy()
      expect(schedule.querySelector('[aria-label="時刻（日本時間）"]')).toBeTruthy()
      expect(schedule.querySelectorAll('#bc-spread').length).toBe(1)
      expect(button('配信前チェックへ').disabled).toBe(true)
      expect(footerReason()).toBe('予約する日付と時刻を入力してください')
      expect(createApi).not.toHaveBeenCalled()
    } finally { unmount() }
  })

  it('分散の分数を空にしても選択が消えず、下書き保存はできる', async () => {
    createApi.mockResolvedValue({ success: true, data: { id: 'draft-1', version: 1 } })
    await renderForm('schedule', { visualQaAugustCampaign: true })
    try {
      await click(container.querySelector<HTMLInputElement>('#broadcast-step-schedule input[value=spread]')!)
      const input = container.querySelector<HTMLInputElement>('#bc-spread')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await flush()
      expect(container.querySelector<HTMLInputElement>('#broadcast-step-schedule input[value=spread]')!.checked).toBe(true)
      expect(container.querySelector('#bc-spread')).toBe(input)
      expect(button('配信前チェックへ').disabled).toBe(true)
      expect(footerReason()).toBe('分散する時間を1〜720の整数で入力してください')
      await click(button('下書きを保存する'))
      expect(createApi.mock.calls[0][0]).toMatchObject({ saveAsDraft: true, draftSendChoice: 'spread', draftSpreadMinutes: '', draftSpreadStart: 'scheduled', stealthSpreadMinutes: 0 })
    } finally { unmount() }
  })

  it('未選択でも書きかけを自動保存し、送信の値は付けない', async () => {
    createApi.mockResolvedValue({ success: true, data: { id: 'draft-1', version: 1 } })
    vi.useFakeTimers()
    await renderForm('schedule', { visualQaAugustCampaign: true })
    try {
      await typeTitle('新しい配信名')
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(createApi).toHaveBeenCalled()
      expect(createApi.mock.calls[0][0]).toMatchObject({ saveAsDraft: true, draftSendChoice: 'unselected', draftTargetMode: 'unselected', targetType: 'tag', targetTagId: '', stealthSpreadMinutes: 0, scheduledAt: null })
      expect(button('配信前チェックへ').disabled).toBe(true)
    } finally { unmount(); vi.useRealTimers() }
  })

  it('全部そろい今すぐを明示して選べば送信設定の段から最終確認へ進める', async () => {
    await renderForm('schedule', { visualQaAugustCampaign: true })
    try {
      await click(container.querySelector<HTMLInputElement>('#broadcast-step-schedule input[value=now]')!)
      expect(button('配信前チェックへ').disabled).toBe(false)
      await click(button('配信前チェックへ'))
      expect(onStepChange).toHaveBeenCalledWith('confirm')
    } finally {
      unmount()
    }
  })

  it('済みの段は帯から戻れ、まだ通っていない先の段へは帯から飛べない', async () => {
    await renderForm('audience', { visualQaAugustCampaign: true, initialCondition: { operator: 'AND', rules: [] } })
    try {
      const band = container.querySelector('nav[aria-label="配信作成の進み"]')!
      const labels = [...band.querySelectorAll('button')].map((item) => item.getAttribute('aria-label'))
      expect(labels).toContain('基本設定に戻る')
      // 宛先が通っていないので、メッセージ・送信設定へは飛べない。
      expect(labels.some((label) => label?.startsWith('メッセージを作成'))).toBe(false)
      expect(labels.some((label) => label?.startsWith('送信設定'))).toBe(false)
    } finally {
      unmount()
    }
  })
})

it('送信設定からメッセージへ直接戻れる', async () => {
  await renderForm('schedule')
  try {
    const back = button('メッセージへ戻る')
    await click(back)
    expect(onStepChange).toHaveBeenCalledWith('message')
    expect(createApi).not.toHaveBeenCalled()
  } finally { unmount() }
})
