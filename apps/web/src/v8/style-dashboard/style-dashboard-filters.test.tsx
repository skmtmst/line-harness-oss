// @vitest-environment happy-dom
/*
 * B27: サロン・面談・教室の担当・講師の欄は、名前が1字で切れない幅にする。
 * 「担当：中川 由美」は実測で欄の文字部 95px・枠の余白 48px＝143px 要る。
 * 広げすぎると B28 の日付の段（1152 で 852px）に載らなくなるので上限も守る。
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

const noop = () => {}

vi.mock('./use-style-dashboard', () => ({
  useStyleDashboard: () => ({
    cfg: {
      title: 'サロン', tabs: { main: '台帳', bookings: '予約', people: 'お客さま', analytics: '分析' },
      staffNoun: '担当', search: '名前・電話で探す', primary: '予約を入れる',
      views: [{ value: 'board', label: '盤' }], defaultView: 'board',
      links: { bookings: '/booking/bookings', people: '/friends' },
    },
    router: { push: () => {} },
    tab: 'main', subTab: null, view: 'board', range: 'today', days: '30',
    accountId: 'account-a', role: 'owner', canWrite: true,
    date: '2026-10-30', setDate: noop, staff: 'all', setStaff: noop,
    compare: 'last_week', setCompare: noop, search: '', setSearch: noop,
    failed: false, analytics: null, analyticsFailed: false, layout: null,
    applyPresentation: () => true, metricSelectionFallback: false, reloadPresentation: noop,
    defaultMetrics: [], viewOpen: false, setViewOpen: noop,
    closureOpen: false, setClosureOpen: noop, phoneOpen: false, setPhoneOpen: noop,
    walkInOpen: false, setWalkInOpen: noop, busy: '', setBusy: noop,
    rosterId: null, setRosterId: noop, asideOpen: false, setAsideOpen: noop,
    floor: null, loadedAt: '2026-10-30T01:02:00+09:00', store: { store: null }, tables: [],
    setParam: noop, load: noop, loadAnalytics: noop, setCardDefaults: noop,
    roster: null, rosterRow: null, today: null,
    preparing: { dialog: null, open: noop }, openPayment: noop, reload: noop,
    subtitle: '', openRow: noop, markVisit: noop, markNoShow: noop, approve: noop,
    undoVisit: noop, cancelRow: null, setCancelRow: noop, refundRow: null, setRefundRow: noop,
    resultRow: null, setResultRow: noop, classRow: null, setClassRow: noop,
    menuFor: () => [], confirmCancel: noop, saveResult: noop, testMode: false,
    alertAction: noop, attend: noop, KIND: {}, saveClosure: noop, addNew: noop,
  }),
}))

import StyleDashboard from './style-dashboard'

afterEach(cleanup)

it('担当の欄は4字の名前が切れない幅（143px以上）で、日付の段に載る幅（160px以下）', () => {
  const view = render(<StyleDashboard style="salon" />)
  const trigger = view.container.querySelector('[aria-label="担当"]') as HTMLElement
  expect(trigger).not.toBeNull()
  const innermost = trigger.closest('[data-entity-picker-field]') as HTMLElement
  expect(innermost).not.toBeNull()
  const field = innermost.parentElement?.closest('[data-entity-picker-field]') as HTMLElement
  expect(field).not.toBeNull()
  const width = Number.parseInt(field.style.width, 10)
  expect(width).toBeGreaterThanOrEqual(143)
  expect(width).toBeLessThanOrEqual(160)
})
