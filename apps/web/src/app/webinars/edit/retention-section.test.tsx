// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebinarAnalyticsPane, webinarAnalytics } from '@/test-utils/webinar-analytics'
import type { WebinarAnalytics } from '@/lib/api'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), webinarApi: { participants: async () => ({ data: { items: [] } }), userComments: async () => ({ data: [] }) } }))


/**
 * J-1「どこまで見られたか」。見ていた人の割合の線・申し込みボタンの縦線・
 * 3つの数字（始まり・最後まで・いちばん離れた所）を出す。
 */
function renderSection(props: { retention: WebinarAnalytics['retention']; completed: number; ctaAtSeconds: number | null; heartbeatRejects: number }) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<WebinarAnalyticsPane analytics={webinarAnalytics({ retention: props.retention, summary: { ...webinarAnalytics().summary, completed: props.completed }, ctaAtSeconds: props.ctaAtSeconds, heartbeatRejects: props.heartbeatRejects })} />)
  })
  return { host, root }
}

let mounted: { host: HTMLDivElement; root: Root } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => mounted?.root.unmount())
  mounted = null
  document.body.innerHTML = ''
})

const retention = {
  bucketSeconds: 60,
  started: 112,
  points: [
    { atSeconds: 0, viewers: 112 },
    { atSeconds: 60, viewers: 100 },
    { atSeconds: 720, viewers: 60 },
    { atSeconds: 780, viewers: 41 },
  ],
}

describe('RetentionSection (J-1)', () => {
  it('線と申し込みボタンの縦線と3つの数字を出す', () => {
    mounted = renderSection({ retention, completed: 41, ctaAtSeconds: 1500, heartbeatRejects: 0 })
    const text = mounted.host.textContent ?? ''
    expect(text).toContain('どこまで見られたか')
    expect(text).toContain('112人')
    expect(text).toContain('41人（37%）')
    expect(text).toContain('11〜12分')
    expect(text).toContain('25:00 申し込みボタンを出した')
    const svg = mounted.host.querySelector('svg[role="img"]')
    expect(svg?.getAttribute('aria-label')).toContain('始まりに見ていた112人')
  })

  it('最後の観測区間の人数で完了人数を代用しない', () => {
    mounted = renderSection({ retention, completed: 70, ctaAtSeconds: null, heartbeatRejects: 0 })
    expect(mounted.host.textContent).toContain('最後まで見た人 63%（70 人）')
    expect(mounted.host.textContent).not.toContain('最後まで見た人 37%（41 人）')
  })

  it('区間が無ければ作らない（0にしない）', () => {
    mounted = renderSection({
      retention: { bucketSeconds: 60, started: 0, points: [] },
      completed: 0,
      ctaAtSeconds: null,
      heartbeatRejects: 0,
    })
    expect(mounted.host.textContent).toContain('まだ視聴データがありません')
    expect(mounted.host.querySelector('#webinar-analytics-retention svg')).toBeNull()
  })

  it('異常の除外があれば件数を出す', () => {
    mounted = renderSection({ retention, completed: 41, ctaAtSeconds: null, heartbeatRejects: 3 })
    expect(mounted.host.textContent).toContain('異常な報告を3 件除いています')
    expect(mounted.host.querySelector('#webinar-analytics-retention svg')?.textContent).not.toContain('申し込みボタンを出した')
  })
})
