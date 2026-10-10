// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Webinar, WebinarAnalytics } from '@/lib/api'
import {
  STEPS,
  nextLabelOf,
  nextStepOf,
  stepStateOf,
} from '@/v8/webinar-edit/helpers'
import { summaryRows } from '@/v8/webinar-edit/review-summary'
import fs from 'node:fs'
import path from 'node:path'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ReviewPane from '@/v8/webinar-edit/review'
import { webinarEditContext, webinarWizardChrome } from '@/test-utils/webinar-edit'
import type { WebinarEditor } from '@/lib/api'
const NOT_AVAILABLE = '—'
const api = vi.hoisted(() => ({ validation: vi.fn(), publish: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), webinarApi: { publishValidation: api.validation, publish: api.publish, notifications: async () => ({ data: { settings: null } }) } }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
const roots: Root[] = []
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount() }); document.body.innerHTML = ''; vi.resetAllMocks() })

const webinar = (over: Partial<Webinar> = {}): Webinar => ({
  id: 'webinar-1',
  accountId: 'visual-qa-account',
  title: 'NEN活用スタートセミナー',
  slug: 'nen-start',
  status: 'active',
  videoPrefix: 'webinars/nen-start',
  durationSeconds: 2538,
  schedule: [{ type: 'daily', time: '10:00' }],
  cta: null,
  ...over,
} as Webinar)

const analytics = (reservations: number): WebinarAnalytics => ({
  summary: {
    reservations, viewers: 0, registeredAndJoined: 0, watched5m: 0, watched15m: 0,
    completed: 0, avgWatchedSeconds: 0, ctaClicks: 0, formSubmissions: 0,
  },
  daily: [],
  participants: [],
} as unknown as WebinarAnalytics)

describe('段の並び', () => {
  it('設計と同じ5段', () => {
    expect(STEPS.map((s) => s.title)).toEqual(['基本設定', '動画', 'CTA・フォーム', '通知', '確認'])
  })

  it('次へは行き先の名前で言う', () => {
    expect(nextLabelOf('video')).toBe('CTA・フォームへ')
    expect(nextStepOf('review')).toBeNull()
    expect(nextLabelOf('review')).toBeNull()
  })
})

describe('段の印', () => {
  it('通り過ぎただけでは済みにしない', () => {
    // 空のまま公開へ進めてしまう。
    expect(stepStateOf('basic', 'video', webinar({ title: '  ' }))).toBe('todo')
    expect(stepStateOf('video', 'cta', webinar({ videoPrefix: null }))).toBe('todo')
    expect(stepStateOf('video', 'cta', webinar({ schedule: [] }))).toBe('todo')
  })

  it('入力が入っていれば済み', () => {
    expect(stepStateOf('basic', 'video', webinar())).toBe('done')
    expect(stepStateOf('video', 'cta', webinar())).toBe('done')
  })

  it('分からないものを済みにしない', () => {
    // 通知の設定は別の口にあり、確認は人が読んで決めること。
    expect(stepStateOf('notifications', 'basic', webinar())).toBe('todo')
    expect(stepStateOf('review', 'basic', webinar())).toBe('todo')
  })

  it('いまの段はいまの段として出す', () => {
    expect(stepStateOf('cta', 'cta', webinar())).toBe('current')
    expect(stepStateOf('basic', 'basic', null)).toBe('current')
  })

  it('CTAの印はカード件数で決める', () => {
    /*
      N-114: 旧 webinar.cta は管理画面から書けない。カードを保存しても
      旧欄を見ると永遠に「todo」のままになるので、件数を渡して判断する。
    */
    expect(stepStateOf('cta', 'basic', webinar(), 2)).toBe('done')
    expect(stepStateOf('cta', 'basic', webinar(), 0)).toBe('todo')
    // 件数を渡さない古い呼び方だけ旧欄へ倒す（旧データの目印として残す）
    expect(stepStateOf('cta', 'basic', webinar({ cta: { label: 'x' } } as Partial<Webinar>))).toBe('done')
    expect(stepStateOf('cta', 'basic', webinar())).toBe('todo')
  })
})

describe('設定サマリー', () => {
  it('未取得は — で、0人とは分ける', () => {
    /*
      設計は「申込 184人」を出しているが、その数は1本ぶんの集計から来る。
      まだ読めていないときに0人と書くと、誰も申し込んでいないように読める。
    */
    const rows = summaryRows(webinar(), null)
    expect(rows.find((r) => r.label === '申込')?.value).toBe(NOT_AVAILABLE)
    expect(summaryRows(webinar(), analytics(0)).find((r) => r.label === '申込')?.value).toBe('0人')
    expect(summaryRows(webinar(), analytics(184)).find((r) => r.label === '申込')?.value).toBe('184人')
  })

  it('足りないものには理由を添える', () => {
    const rows = summaryRows(webinar({ videoPrefix: null, schedule: [] }), analytics(0))
    expect(rows.find((r) => r.label === '動画')?.note).toContain('視聴できません')
    expect(rows.find((r) => r.label === '配信枠')?.note).toContain('次の回')
  })

  it('内部の値をそのまま出さない', () => {
    for (const status of ['active', 'draft', 'archived'] as const) {
      const value = summaryRows(webinar({ status }), null).find((r) => r.label === '公開')?.value
      expect(value).not.toMatch(/[a-z]/)
    }
  })
})

describe('公開の可否', () => {
  it('足りないものを1つずつ言う', async () => {
    api.validation.mockResolvedValue({ data: { version: 2, blockers: ['動画が設定されていません', '配信枠が1件もありません'], warnings: [], checks: [{ key: 'video', label: '動画', status: 'failed' }, { key: 'schedule', label: '配信枠', status: 'failed' }] } })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host); roots.push(root)
    await act(async () => root.render(<ReviewPane ctx={webinarEditContext(webinar({ videoPrefix: null, schedule: [] }), { version: 2 } as WebinarEditor)} chromeFor={primary => ({ ...webinarWizardChrome, footerActions: primary })} />))
    expect(host.textContent).toContain('動画が設定されていません')
    expect(host.textContent).toContain('配信枠が1件もありません')
    const publish = [...host.querySelectorAll('button')].find(button => button.textContent === 'この版を公開')!
    expect(publish.disabled).toBe(true)
    await act(async () => publish.click())
    expect(api.publish).not.toHaveBeenCalled()
  })
})

describe('撮影の目印', () => {
  it('設計Nodeがある段だけ、そのNodeを目印にする', () => {
    /*
      基本設定は編集画面ぶんの設計面が無い（`lvaY5` は作成画面の面）。
      Nodeを流用すると、別のルートの絵をこの画面から撮ってしまう。
    */
    for (const [file, id] of [['basic', 'j7PP04'], ['video', 'VWNaA'], ['cta', 'Q0Jrk'], ['notifications', 'E7iAYs'], ['review', 'XCUNf']]) {
      expect(fs.readFileSync(path.join(__dirname, `../../../v8/webinar-edit/${file}.tsx`), 'utf8')).toContain(id)
    }
    expect(fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/edit.tsx'), 'utf8')).not.toContain('data-qa-open')
  })

  it('目印は重ならない', () => {
    expect(new Set(STEPS.map((s) => s.key)).size).toBe(STEPS.length)
  })
})
