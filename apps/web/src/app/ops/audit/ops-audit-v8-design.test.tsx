// @vitest-environment happy-dom
/*
 * 板 `e7ljE` 監査ログの絵合わせ（V8）。
 * - 頭：説明＋CSVで書き出すが右
 * - 札：すべて・4種、日付には開始日・終了日の名
 * - 表：日時・Dto・操作・契約先・理由の5列（IPは出さない）、短い日時と絵の操作名
 * - 脚注：消せない・理由は4文字以上
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsAuditPage from './page'
import type { OpsAuditRow } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (index: number, action: string): OpsAuditRow => ({
  id: `log-${index}`,
  created_at: '2026-10-01T15:20:00.000+09:00',
  staff_name: '河野',
  tenant_name: '然-NEN-本部',
  action,
  reason: '問い合わせ #1042 の確認',
  ip: '203.0.113.1',
  visible_to_tenant: false,
} as OpsAuditRow)

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
  const rows = [row(0, 'impersonation.start'), row(1, 'tenant.status.change'), row(2, 'pii.reveal'), row(3, 'member.invite')]
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: rows, total: rows.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })))
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

describe('e7ljE 監査ログの絵合わせ', () => {
  it('頭・札・表・脚注が絵どおり', async () => {
    await act(async () => { root.render(<OpsAuditPage />) })
    await settle()
    const body = text()
    expect(body).toContain('運営が行った操作の記録です')
    expect(body).toContain('CSV で書き出す')
    for (const chip of ['すべて', '代理ログイン', '個人情報の表示', '契約先の停止', '運営メンバー']) {
      expect(body).toContain(chip)
    }
    expect(body).toContain('開始日')
    expect(body).toContain('終了日')
    expect(body).toContain('10/1 15:20')
    expect(body).toContain('代理ログイン（閲覧）')
    expect(body).toContain('契約先の停止')
    expect(body).toContain('個人情報の表示')
    expect(body).toContain('運営メンバー')
    expect(body).toContain('記録は運営メンバーでも消せません。理由は4文字以上が必須です。')
    // IP の列は出さない
    expect(body).not.toContain('203.0.113.1')
  })
})
