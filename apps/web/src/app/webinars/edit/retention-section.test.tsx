// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import RetentionSection from './retention-section'

/**
 * J-1「どこまで見られたか」。見ていた人の割合の線・申し込みボタンの縦線・
 * 3つの数字（始まり・最後まで・いちばん離れた所）を出す。
 */
function renderSection(props: Omit<React.ComponentProps<typeof RetentionSection>, 'durationSeconds'>) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<RetentionSection {...props} durationSeconds={1800} />)
  })
  return { host, root }
}

let mounted: { host: HTMLDivElement; root: Root } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  mounted?.root.unmount()
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
    expect(text).toContain('申し込みボタン（25分）')
    const svg = mounted.host.querySelector('svg[role="img"]')
    expect(svg?.getAttribute('aria-label')).toContain('始まりに見ていた112人')
  })

  it('区間が無ければ作らない（0にしない）', () => {
    mounted = renderSection({
      retention: { bucketSeconds: 60, started: 0, points: [] },
      completed: 0,
      ctaAtSeconds: null,
      heartbeatRejects: 0,
    })
    expect(mounted.host.textContent).toContain('まだ視聴データがありません')
    expect(mounted.host.querySelector('svg')).toBeNull()
  })

  it('異常の除外があれば件数を出す', () => {
    mounted = renderSection({ retention, completed: 41, ctaAtSeconds: null, heartbeatRejects: 3 })
    expect(mounted.host.textContent).toContain('異常な報告を3件除いています')
    expect(mounted.host.textContent).not.toContain('申し込みボタン')
  })
})
