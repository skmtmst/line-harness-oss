// @vitest-environment happy-dom
/*
 * 板 `P0jhqO` 運営お問い合わせの絵合わせ（V8）。
 * - 頭：説明＋代わりに起票する
 * - 左：チケットを探す、6つの札（保留は口が無いので出さない）、
 *   優先度：すべて、並び替え：優先度、行に契約先・優先度
 * - 右：契約先を開く・代理ログイン、1行の契約先情報、
 *   足元に解決済みにする・クローズする・下書きを保存する・返信する
 * - 数のカード・上の段切り替えは V8 では出さない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsSupportPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

const ticket = {
  id: 't1', ticketNo: 1042, ticketLabel: '#1042', tenantId: 'tenant-a', tenantName: '然-NEN-本部',
  tenantPlanKey: 'standard', tenantPlanStatus: 'active', tenantStatus: 'active',
  staffId: 's1', staffName: '高田 誠', staffRole: 'owner', staffEmailRegistered: true,
  kind: 'bug', kindLabel: '不具合', subject: 'LINE の Webhook が遅れる', subjectAuto: false,
  body: '9/30 の朝から、予約が入った知らせが 5〜10 分遅れて届きます。', attachments: [],
  stage: 'in_progress', stageLabel: '対応中', priority: 'high', priorityLabel: '高', channel: 'line', channelLabel: 'LINE',
  assigneeStaffId: null, replyCount: 0, firstRepliedAt: null, lastMessageAt: new Date().toISOString(), resolvedAt: null, closedAt: null,
  createdAt: '2026-09-30T11:00:00.000+09:00', updatedAt: '2026-09-30T11:00:00.000+09:00',
}

function respond(url: string) {
  const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
  if (url.endsWith('/api/ops/support/summary')) {
    return json({ success: true, data: { byStage: { all: 5, new: 2, in_progress: 3, waiting: 1, resolved: 12, closed: 40 }, kpis: null } })
  }
  if (url.includes('/api/ops/support/tickets?')) return json({ success: true, data: [ticket], total: 5 })
  if (url.endsWith('/api/ops/support/tickets/t1')) {
    return json({
      success: true,
      data: {
        ticket,
        tenant: { accountCount: 4, staffCount: 6, staffWithLine: 5, pastTickets: 12, pastOpen: 0 },
        messages: [],
        draft: null,
        knowledge: undefined,
        ai: { available: true },
      },
    })
  }
  // 書ける運営メンバー（閲覧のみなら起票・返信の操作を出さない）。
  if (url.endsWith('/api/ops/me')) return json({ success: true, data: { id: 'ops-1', readOnly: false } })
  return json({ success: false, error: 'unexpected' }, 404)
}

let host: HTMLDivElement
let root: Root

function text(): string {
  return host.textContent ?? ''
}

async function settle(turns = 8) {
  for (let i = 0; i < turns; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => respond(String(input))))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

describe('P0jhqO お問い合わせの絵合わせ', () => {
  it('頭・左・右・足元が絵どおり', async () => {
    await act(async () => { root.render(<OpsSupportPage />) })
    await settle()
    const body = text()
    // 頭
    expect(body).toContain('統括の管理画面「お問い合わせ」から送られたものが新規として並びます')
    expect(body).toContain('代わりに起票する')
    // 左の札（保留は出さない）
    for (const chip of ['すべて', '新規', '対応中', '確認待ち', '解決', 'クローズ']) {
      expect(body).toContain(chip)
    }
    expect(body).not.toContain('保留')
    expect(body).toContain('優先度：すべて')
    expect(body).toContain('並び替え：優先度')
    // 行
    expect(body).toContain('#1042')
    expect(body).toContain('然-NEN-本部・優先度 高')
    // 右
    expect(body).toContain('契約先を開く')
    expect(body).toContain('代理ログイン')
    expect(body).toContain('LINE登録あり・不具合・優先度 高')
    // 足元
    for (const action of ['解決済みにする', 'クローズする', '下書きを保存する', '返信する']) {
      expect(body).toContain(action)
    }
    // V8 では出さない塊
    expect(body).not.toContain('未対応のチケット')
    expect(body).not.toContain('解決率')
  })
})
