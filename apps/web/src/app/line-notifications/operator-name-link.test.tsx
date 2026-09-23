// @vitest-environment happy-dom
/*
 * NOTIFY-04 の固定検査。
 *
 * 監査で「運用者へのお知らせ一覧の名前を押しても編集画面へ進まない」が
 * 挙がった。ここでは実物の OperatorNotificationRules を実DOMへ置き、
 * ・名前が /line-notifications/operator/new?id=<id> のリンクとして描かれる
 * ・id は encodeURIComponent でそのまま復元できる形にする
 * ・行・セル・表のどこにもクリックを止める差し込みが無い
 * ことを固定する。実ブラウザでの遷移は
 * line-notifications-browser-behavior.mjs の「NOTIFY-04」で確かめる。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  operatorList: vi.fn(),
  publish: vi.fn(),
  stop: vi.fn(),
  testSend: vi.fn(),
  exportCsv: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) {
      super(`API error ${status}`)
      this.status = status
    }
  }
  return {
    ApiError,
    api: {
      lineNotifications: {
        operatorRules: {
          list: fixture.operatorList,
          publish: fixture.publish,
          stop: fixture.stop,
          test: fixture.testSend,
          exportCsv: fixture.exportCsv,
        },
      },
    },
  }
})

import type { OperatorNotificationRule } from '@/lib/api'
import OperatorNotificationRules from './operator-notification-rules'

function rule(overrides: Partial<OperatorNotificationRule> = {}): OperatorNotificationRule {
  return {
    id: 'rule-abc 123',
    lineAccountId: 'account-a',
    name: '新しい予約が入りました',
    eventType: 'reservation.created',
    conditions: { recipientLabel: '1人', scheduleLabel: 'いつでも' },
    channels: ['dashboard', 'line'],
    status: 'published',
    recipientCount: 1,
    occurredToday: 0,
    version: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as OperatorNotificationRule
}

const summary = { total: 1, published: 1, stopped: 0, missingRecipients: 0, recipients: 1, acceptedToday: 0, excludedToday: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  fixture.operatorList.mockResolvedValue({ success: true, data: { items: [rule()], summary } })
  vi.stubGlobal('React', React)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NOTIFY-04 一覧の名前から編集画面へ戻る', () => {
  it('名前は ?id= 付きの編集画面へのリンクとして描かれる', async () => {
    render(<OperatorNotificationRules lineAccountId="account-a" />)

    const link = await screen.findByRole('link', { name: '新しい予約が入りました' })
    // id に空白があっても壊れない。デコードすると元の id に戻る形で出す。
    expect(link.getAttribute('href')).toBe('/line-notifications/operator/new?id=rule-abc%20123')
    expect(new URLSearchParams('id=rule-abc%20123').get('id')).toBe('rule-abc 123')
  })

  it('名前のクリックを表・行・セルのどこも止めない', async () => {
    render(<OperatorNotificationRules lineAccountId="account-a" />)
    const link = await screen.findByRole('link', { name: '新しい予約が入りました' })

    /*
      「リンクは正しいのに押しても動かない」は、祖先の誰かが
      preventDefault している形だけが起こしうる。実DOMへ
      バブリング経路の最後（document）で defaultPrevented を読み、
      途中で止められた形になっていないことを固定する。
    */
    let reachedDocument = false
    let prevented = false
    const listener = (event: Event) => {
      reachedDocument = true
      prevented = event.defaultPrevented
    }
    document.addEventListener('click', listener)

    fireEvent.click(link)
    document.removeEventListener('click', listener)

    expect(reachedDocument).toBe(true)
    expect(prevented).toBe(false)
  })

  it('別の行の名前も同じ形のリンクで、絞り込みタブと検索は動いたまま', async () => {
    fixture.operatorList.mockResolvedValue({
      success: true,
      data: { items: [rule(), rule({ id: 'rule-2', name: 'レビューが届きました' })], summary: { ...summary, total: 2 } },
    })
    render(<OperatorNotificationRules lineAccountId="account-a" />)

    const second = await screen.findByRole('link', { name: 'レビューが届きました' })
    expect(second.getAttribute('href')).toBe('/line-notifications/operator/new?id=rule-2')

    // 絞り込み（公開中だけ）と検索は行を絞るだけで、リンクの形は変わらない。
    fireEvent.click(screen.getByRole('radio', { name: /出している/ }))
    expect(screen.getByRole('link', { name: 'レビューが届きました' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('お知らせ名・きっかけで探す'), { target: { value: 'レビュー' } })
    expect(screen.queryByRole('link', { name: '新しい予約が入りました' })).toBeNull()
    expect(screen.getByRole('link', { name: 'レビューが届きました' }).getAttribute('href'))
      .toBe('/line-notifications/operator/new?id=rule-2')
  })
})
