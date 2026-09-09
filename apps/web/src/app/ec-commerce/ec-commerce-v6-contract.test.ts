import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const tabs = readFileSync(join(import.meta.dirname, 'ec-tabs.ts'), 'utf8')
const tabsView = readFileSync(join(import.meta.dirname, 'ec-tabs-view.tsx'), 'utf8')
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

  it('shows API-counted totals on the EC entry tabs without inventing failed counts', () => {
    expect(tabsView).toContain('Promise.allSettled')
    expect(tabsView).toContain('api.ecCommerce.overview(accountId)')
    expect(tabsView).toContain('api.ecCommerce.operationIdentityCandidates')
    expect(tabsView).toContain('api.ecCommerce.subscriptions')
    expect(tabsView).toContain("overview.status === 'fulfilled' && overview.value.success")
    expect(tabsView).toContain("identities.status === 'fulfilled' && identities.value.success")
    expect(tabsView).toContain("subscriptions.status === 'fulfilled' && subscriptions.value.success")
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

  it('shows connector impact and retry policy from the API contract', () => {
    expect(connector).toContain('Object.values(data?.impact ?? {})')
    expect(connector).toContain('このつなぎ先を止めると影響する設定・集計です。NEN配信・マイル・友だち属性は全体の件数です。')
    expect(connector).toContain('data?.retryPolicy')
    expect(connector).not.toContain('いま影響件数を数える口は未接続です')
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

  it('filters action executions on the server and pages through old failures', () => {
    // 21件目以降の失敗に届かない(#517 中1)。絞りはサーバへ渡し、手元で再絞りしない。
    expect(page).toContain('actionServerFilter(status)')
    expect(page).toContain("statusGroup: status")
    expect(page).toContain('offset: String((page - 1) * ACTION_PAGE_SIZE)')
    expect(page).toContain('total: response.data.total')
    expect(page).toContain('pageCount > 1 ? <Pagination')
    expect(page).not.toContain("return action.status === status")
    expect(api).toContain("statusGroup?: 'processing' | 'failed'")
    expect(api).toContain("query.set('statusGroup', params.statusGroup)")
  })

  it('keeps EC fixture event types in the dotted production form', () => {
    // fixtures のアンダースコア形だと画面の出来事名が「ECの出来事」に落ちる(#517 中5)。
    const fixtures = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'fixtures.mjs'), 'utf8')
    const start = fixtures.indexOf('export const EC_EVENTS')
    const end = fixtures.indexOf('export const EC_IDENTITY_CANDIDATES')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const section = fixtures.slice(start, end)
    const types = [...section.matchAll(/eventType: '([^']+)'/g)].map((match) => match[1])
    expect(types.length).toBeGreaterThan(0)
    for (const eventType of types) {
      expect(eventType).toMatch(/^ec\.[a-z]+\.[a-z_]+$/)
    }
    expect(section).not.toContain('ec_order.')
    expect(section).not.toContain('ec_payment.')
    expect(section).not.toContain('ec_shipping.')
    expect(section).not.toContain('ec_subscription.')
    expect(section).not.toContain('ec_support.')
  })

  it('shares one date formatter across the three EC screens (#580)', () => {
    expect(page).toContain("from './ec-datetime'")
    expect(connector).toContain("from './ec-datetime'")
    expect(subscriptions).toContain("from './ec-datetime'")
    expect(page).not.toContain('function dateTime(')
    expect(connector).not.toContain('function dateTime(')
    expect(subscriptions).not.toContain('function shortDate(')
  })

  it('filters subscriptions with the shared Tabs and types impact metrics (#580)', () => {
    expect(subscriptions).toContain("from '@/components/shared/tabs'")
    expect(subscriptions).toContain('<Tabs items={FILTERS.map(')
    expect(subscriptions).not.toContain('styles.filterCurrent')
    expect(identity).toContain('impactText(order)')
    expect(identity).toContain('isImpactMetric')
    expect(identity).toContain('NOT_AVAILABLE')
    expect(api).toContain('impact: IdentityCandidateImpactMetric[]')
  })
})
