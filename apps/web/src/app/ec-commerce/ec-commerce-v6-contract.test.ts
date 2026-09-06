import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const subscriptions = readFileSync(join(import.meta.dirname, 'subscriptions-panel.tsx'), 'utf8')
const connector = readFileSync(join(import.meta.dirname, 'connector-panel.tsx'), 'utf8')
const api = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 EC integration screens', () => {
  it('connects all four EC tabs to real routes', () => {
    expect(page).toContain("{ key: 'events', label: '取り込みの記録' }")
    expect(page).toContain("href: '/ec-commerce/identity-candidates'")
    expect(page).toContain("{ key: 'subscriptions', label: '定期便' }")
    expect(page).toContain("{ key: 'connector', label: 'つなぎ先' }")
    expect(page).not.toContain('準備中')
    expect(page).not.toContain('<Header')
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
})
