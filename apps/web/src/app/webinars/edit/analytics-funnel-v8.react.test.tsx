// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import AnalyticsFunnelV8 from './analytics-funnel-v8'
import type { WebinarAnalytics } from '@/lib/api'

/*
 * ウェビナー分析の数の帯と棒（V8-B `z2dgw`）の契約。
 * 数は集計の口の実データで、段ごとの減りといちばん減っている段が出る。
 */

const summary: WebinarAnalytics['summary'] = {
  reservations: 124,
  viewers: 100,
  registeredAndJoined: 90,
  watched5m: 85,
  watched15m: 80,
  completed: 71,
  avgWatchedSeconds: 1800,
  ctaClicks: 23,
  formSubmissions: 9,
}

/*
 * 「今月」の合計はいつ走っても同じになるよう、日付は今月・先月で作る。
 * 先月10 + 今月20 + 今月11 ＝ 今月 +31。
 */
const jstNow = new Date()
const thisMonth = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}`
const prevMonth = jstNow.getUTCMonth() === 0
  ? `${jstNow.getUTCFullYear() - 1}-12`
  : `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth()).padStart(2, '0')}`
const daily: WebinarAnalytics['daily'] = [
  { date: `${prevMonth}-28`, reservations: 10, viewers: 8, ctaClicks: 2, formSubmissions: 1 },
  { date: `${thisMonth}-01`, reservations: 20, viewers: 16, ctaClicks: 4, formSubmissions: 2 },
  { date: `${thisMonth}-03`, reservations: 11, viewers: 9, ctaClicks: 1, formSubmissions: 0 },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

function renderFunnel() {
  act(() => {
    root.render(<AnalyticsFunnelV8 summary={summary} daily={daily} />)
  })
}

test('数の帯に実数と補足が出る（直書きの数にしない）', () => {
  renderFunnel()
  const text = container.textContent ?? ''
  // 申込124・今月の合計31（20+11）。
  expect(text).toContain('124')
  expect(text).toContain('今月 +31')
  // 参加は申込の81%、視聴完了は参加の71%。
  expect(text).toContain('申込の81%')
  expect(text).toContain('参加の71%')
  // フォーム送信は件で、CTAを押した23人のうち。
  expect(text).toContain('CTAを押した23人のうち')
})

test('棒に5段と減り・いちばん減っている段が出る', () => {
  renderFunnel()
  const text = container.textContent ?? ''
  for (const label of ['申込', '参加（入場）', '視聴完了', 'CTAを押した', 'フォーム送信']) {
    expect(text).toContain(label)
  }
  // 124→100（-24）、100→71（-29）、71→23（-48）、23→9（-14）。
  expect(text).toContain('-24')
  expect(text).toContain('-29')
  expect(text).toContain('-48')
  expect(text).toContain('-14')
  // いちばん減っているのは視聴完了→CTAを押した。
  expect(text).toContain('いちばん減っているのは「視聴完了 → CTAを押した」です')
})

test('申込が無いときは割合を「—」にする（0にしない）', () => {
  act(() => {
    root.render(
      <AnalyticsFunnelV8
        summary={{ ...summary, reservations: 0, viewers: 0, completed: 0, ctaClicks: 0, formSubmissions: 0 }}
        daily={[]}
      />,
    )
  })
  expect(container.textContent).toContain('申込の—')
})


test('直接参加で人数が増えた段も棒をはみ出さず増加で示す', () => {
  act(() => { root.render(<AnalyticsFunnelV8 summary={{ ...summary, reservations: 20, viewers: 100 }} daily={[]} />) })
  expect(container.textContent).toContain('+80')
  expect(container.textContent).not.toContain('--80')
  for (const bar of container.querySelectorAll<HTMLElement>('[style]')) {
    expect(parseFloat(bar.style.width)).toBeLessThanOrEqual(100)
  }
})
