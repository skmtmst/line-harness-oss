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
    expect(tabsView).toContain("overview.status === 'fulfilled' && overview.value.success")
    expect(tabsView).toContain("identities.status === 'fulfilled' && identities.value.success")
    /*
     * 定期便の件数は `overview` から取る(#731)。以前は `api.ecCommerce.subscriptions`
     * を `limit:1` で叩いていたが、**`limit:1` でも 500 行ぶん働く**作りだった。
     * 元の表明「どの数も API が数えたものだけを出し、失敗を 0 と偽らない」は
     * ここで保つ——定期便も `overview` の成否判定の中に入るので、失敗時は
     * `undefined`(タブに数字を出さない)のままになる。
     */
    expect(tabsView).toContain('overview.value.data.subscriptions')
    expect(tabsView).not.toContain('api.ecCommerce.subscriptions')
  })

  it('keeps badges off green/red and the sort select wide (V7 touch-up)', () => {
    // 1段だけのパンくずは画面名と重複するので出さない。
    expect(page).not.toContain("label: '専用機能'")
    // 「確認」「つき合わせ」の札は注意・中立にし、緑（正常の意味だけ）は使わない。
    expect(page).toContain('badge="つき合わせ" badgeTone="neutral"')
    expect(page).toContain('badge="確認" badgeTone="neutral"')
    expect(page).not.toContain('badgeTone="danger"')
    // 並び順の欄は共通 Select の full 幅で、外側で sm:w-64 を持つ。
    expect(page).toContain('aria-label="取り込みの並び順"')
    expect(page).toContain('size="full"')
    expect(page).toContain('w-full sm:w-64')
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

  it('shows connector impact scoped to EC triggers plus an always-visible retry note', () => {
    // #517 中5b: つなぎ先単位のやり直し方針は本番で常に null。モックだけが
    // 別の文言を返していたので、モックを null に揃え、画面の死に分岐を消した。
    // #948 N-320: 影響件数はEC起点の設定だけを数え、行ごとに範囲を添える。
    // やり直しかたは値に依存せず常時表示する(実行単位の手動やり直しへの行き先)。
    const mockApi = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'mock-api.mjs'), 'utf8')
    expect(connector).toContain('Object.values(data?.impact ?? {})')
    expect(connector).toContain('「ECの出来事がきっかけ」とあるものは、このつなぎ先を止めると止まります。コンバージョンと分析はアカウント全体の記録数です。')
    expect(connector).toContain("'ECの出来事がきっかけ'")
    expect(connector).toContain("'アカウント全体'")
    expect(connector).toContain('失敗した処理のやり直しは「取り込みの記録」タブで一件ずつ「もう一度やる」から行います。')
    expect(connector).not.toContain('data?.retryPolicy')
    expect(connector).not.toContain('やり直しの決めごと')
    expect(connector).not.toContain('いま影響件数を数える口は未接続です')
    expect(mockApi).toContain('retryPolicy: null')
    expect(mockApi).not.toContain('3回まで・10分あけて')
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
