import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const tabs = readFileSync(join(import.meta.dirname, 'ec-tabs.ts'), 'utf8')
const identity = readFileSync(join(import.meta.dirname, 'identity-candidates', 'page.tsx'), 'utf8')
const subscriptions = readFileSync(join(import.meta.dirname, 'subscriptions-panel.tsx'), 'utf8')
const connector = readFileSync(join(import.meta.dirname, 'connector-panel.tsx'), 'utf8')
const api = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 EC integration screens', () => {
  it('connects all four EC tabs to real routes', () => {
    expect(tabs).toContain("{ key: 'events', label: '取り込みの記録' }")
    expect(tabs).toContain("href: '/ec-commerce/identity-candidates'")
    expect(tabs).toContain("{ key: 'subscriptions', label: '定期便' }")
    expect(tabs).toContain("{ key: 'connector', label: 'つなぎ先' }")
    expect(page).not.toContain('準備中')
    expect(page).not.toContain('<Header')
  })

  it('shows the V6 decision information without inventing unavailable values', () => {
    for (const wording of ['今日 取り込んだ', 'つながっていない注文', '取り込みに失敗', '最後に届いた']) {
      expect(page).toContain(wording)
    }
    for (const wording of ['候補が見つかった', '自動で結びついた', '結びつけると増える売上', '同じ人が2人いる疑い']) {
      expect(identity).toContain(wording)
    }
    expect(page).toContain('order.orderLines.map')
    expect(page).toContain('order.totalAmount.toLocaleString')
    expect(identity).toContain('operations?.summary.linked')
    expect(identity).toContain('operations?.summary.potentialRevenue')
    expect(identity).toContain('過去のLINE送信は再送しません')
  })

  it('uses state-specific feedback and never turns missing values into zero', () => {
    for (const source of [page, subscriptions, connector]) {
      expect(source).toContain("'forbidden'")
      expect(source).toContain("'error'")
      expect(source).toContain("'empty'")
      expect(source).toContain("'loading'")
    }
    expect(subscriptions).toContain("monthlyAmount === null ? '今月の金額は未取得'")
    expect(connector).toContain("'— 未取得'")
  })

  it('reads subscription facts and writes versioned connector settings without exposing the secret', () => {
    expect(api).toContain('/api/ec-commerce/subscriptions?')
    expect(api).toContain('/api/ec-commerce/connector?')
    expect(connector).toContain('expectedVersion')
    expect(connector).toContain('type="password"')
    expect(connector).toContain('鍵そのものは表示しません')
    expect(connector).not.toContain('inbound_secret_encrypted')
  })

  it('reads the normalized order/action mouths and retries only retryable failures', () => {
    expect(api).toContain('/api/ec-commerce/orders?')
    expect(api).toContain('/api/ec-commerce/action-executions?')
    expect(api).toContain('/api/ec-commerce/identity-candidates?')
    expect(api).toContain('/api/ec-commerce/action-executions/${encodeURIComponent(id)}/retry')
    expect(page).toContain('action.retryAvailable ?')
    expect(page).toContain('expectedVersion: action.version')
    expect(page).toContain('crypto.randomUUID()')
    expect(page).not.toContain('失敗だけを再試行する受け口は未接続')
  })
})
