import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'webhook-interactions.tsx'), 'utf8')
const HOST = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const API = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 外部連携・やり取りの記録 KNG00', () => {
  it('実ノードと実ルートを接続する', () => {
    expect(PAGE).toContain('data-design-node="KNG00"')
    expect(HOST).toContain("{ key: 'interactions', label: 'やり取りの記録' }")
    expect(HOST).toContain("tab === 'interactions' && <WebhookInteractions />")
    expect(API).toContain('/api/webhooks/interactions?')
  })

  it('読込・空・失敗を分け、未取得を0件と見せない', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('value={data.summary.averageDurationMs == null ? null')
    expect(PAGE).toContain("data.summary.averageDurationMs == null ? '未取得'")
  })

  it('URL・シークレット・本文を画面へ出さず、内部エラーも表示しない', () => {
    expect(PAGE).toContain('接続先URL、シークレット、本文は安全のため表示しません。')
    expect(PAGE).not.toContain('API error:')
    expect(PAGE).not.toContain('Failed to fetch')
    expect(PAGE).not.toContain('requestBodyJson')
    expect(PAGE).not.toContain('idempotencyKey')
  })

  it('送り直しは管理者だけに見せ、単体と一括の両方を持つ', () => {
    expect(PAGE).toContain("role === 'owner' || role === 'admin'")
    expect(PAGE).toContain('失敗したものをまとめてやり直す')
    expect(PAGE).toContain("canRetry && item.canRetry ? <Button")
  })

  it('本文に画面タイトルや説明を重ねない', () => {
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<h1')
  })
})
