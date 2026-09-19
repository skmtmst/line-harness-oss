// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportNewPage from './reports/new/page'

/**
 * 定期レポート作成/編集画面の「入れる項目」と「知らせの決めごと」を
 * 本物のReactで動かす試験(#951 / N-284・N-285)。
 *
 * 文字列契約だけでは「選べるのに必ず未取得になる節」「固定表示で
 * 変えられないしきい値」がすり抜ける。通信だけを差し替え、POST/PUTの
 * 実際の本文と、入力が効く/効かない状態を読む。
 */

const fixture = vi.hoisted(() => ({
  editId: null as string | null,
  role: 'owner' as 'owner' | 'staff',
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
  handler: ((url: string) =>
    Promise.reject(new Error(`未設定: ${url}`))) as
      (url: string, init?: RequestInit) => Promise<unknown>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? fixture.editId : null) }),
  usePathname: () => '/analytics/reports/new',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageChrome: () => ({ title: null, fullWidth: false }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const body = await net.handler(path, init)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

const OPTIONS = {
  timeZone: 'Asia/Tokyo',
  savedAnalyses: [{ id: 'saved-1', name: '流入別の成果', kind: 'cross' }],
  recipients: [{ id: 'u-1', name: 'テスト', role: 'owner', email: 'a@example.com', lineLinked: true }],
}

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1', lineAccountId: 'account-a', name: '週次まとめ',
    sections: ['friends', 'reactions'], savedAnalysisIds: [],
    cadence: 'weekly', weekday: 3, monthDay: null,
    sendTime: '10:30', timeZone: 'Asia/Tokyo', periodDays: 30,
    recipients: [{ kind: 'staff', staffId: 'u-1', label: 'テスト' }],
    channels: ['dashboard', 'email'],
    alertRules: [
      { metric: 'block_rate', operator: 'greater_than', threshold: 0.5, minimumSample: 20 },
      { metric: 'friend_adds', operator: 'decrease_percent', threshold: 20, minimumSample: 20 },
      { metric: 'conversions', operator: 'zero_streak_days', threshold: 3, minimumSample: 20 },
    ],
    status: 'active', isOneTime: false,
    nextRunAt: '2026-09-24T01:30:00.000Z', createdBy: 'u-1',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const fixtureSchedule = vi.hoisted(() => ({ value: schedule() as ReturnType<typeof schedule> }))

function defaultHandler(path: string, init?: RequestInit) {
  if (path === '/api/staff/me') return Promise.resolve({ success: true, data: { role: fixture.role } })
  if (path.startsWith('/api/analytics/report-schedules/') && init?.method === 'PUT') {
    return Promise.resolve({ success: true, data: { ...fixtureSchedule.value, updatedAt: '2026-09-02T00:00:00.000Z' } })
  }
  if (path.startsWith('/api/analytics/report-schedules') && init?.method === 'POST') {
    return Promise.resolve({ success: true, data: schedule({ id: 'report-new' }) })
  }
  if (path.startsWith('/api/analytics/report-schedules')) {
    return Promise.resolve({ success: true, data: { items: [fixtureSchedule.value], options: OPTIONS } })
  }
  return Promise.reject(new Error(`未設定: ${path}`))
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.editId = null
  fixture.role = 'owner'
  fixtureSchedule.value = schedule()
  net.calls.length = 0
  net.handler = defaultHandler
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<ReportNewPage />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  )
  if (!found) throw new Error(`ボタンが見つからない: ${label} / ${host.textContent}`)
  return found
}

function sectionCheckbox(title: string): HTMLInputElement {
  const strong = Array.from(host.querySelectorAll('strong')).find((item) => item.textContent?.trim() === title)
  const input = strong?.closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
  if (!input) throw new Error(`「${title}」のチェックが見つかりません`)
  return input
}

function numberInput(ariaLabel: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${ariaLabel}"]`) as HTMLInputElement | null
  if (!input) throw new Error(`「${ariaLabel}」の入力が見つかりません`)
  return input
}

async function typeNumber(ariaLabel: string, value: string) {
  const input = numberInput(ariaLabel)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

const writeCalls = (method: string) => net.calls.filter((call) => call.method === method)

describe('定期レポートの「入れる項目」(N-284)', () => {
  it('数字を出せない「マイルと紹介」は新規には選べず、理由を添える', async () => {
    await render()

    const mileage = sectionCheckbox('マイルと紹介')
    expect(mileage.disabled).toBe(true)
    expect(mileage.checked).toBe(false)
    expect(host.textContent).toContain('まだ接続されていません')

    // ほかの節はふつうに選べる。
    expect(sectionCheckbox('友だちの増減').disabled).toBe(false)

    // 宛先を選んで作っても、マイルは本文へ入らない。
    const personCheck = Array.from(host.querySelectorAll('input[type="checkbox"]')).find((item) => !(item as HTMLInputElement).disabled && item.closest('label')?.textContent?.includes('テスト')) as HTMLInputElement
    await act(async () => { personCheck.click(); await Promise.resolve() })
    await act(async () => { button('つくって動かす').click(); await Promise.resolve() })
    const post = writeCalls('POST').at(-1)
    expect((post?.body as { sections: string[] }).sections).not.toContain('mileage')
  })

  it('既存レポートに入っているマイルは、外せる向きだけ残す', async () => {
    fixtureSchedule.value = schedule({ sections: ['friends', 'mileage'] })
    fixture.editId = 'report-1'
    await render()

    const mileage = sectionCheckbox('マイルと紹介')
    expect(mileage.disabled).toBe(false)
    expect(mileage.checked).toBe(true)

    // 外すと保存できる。外したあとはもう付け直せない。
    await act(async () => { mileage.click(); await Promise.resolve() })
    expect(sectionCheckbox('マイルと紹介').checked).toBe(false)
    expect(sectionCheckbox('マイルと紹介').disabled).toBe(true)

    await act(async () => { button('変更を保存する').click(); await Promise.resolve() })
    const put = writeCalls('PUT').at(-1)
    expect((put?.body as { sections: string[] }).sections).toEqual(['friends'])
  })
})

describe('定期レポートの「知らせの決めごと」(N-285)', () => {
  it('既定の3条件はそのままPOSTされる', async () => {
    await render()
    const personCheck = Array.from(host.querySelectorAll('input[type="checkbox"]')).find((item) => !(item as HTMLInputElement).disabled && item.closest('label')?.textContent?.includes('テスト')) as HTMLInputElement
    await act(async () => { personCheck.click(); await Promise.resolve() })
    await act(async () => { button('つくって動かす').click(); await Promise.resolve() })

    const post = writeCalls('POST').at(-1)
    expect((post?.body as { alertRules: unknown[] }).alertRules).toEqual([
      { metric: 'block_rate', operator: 'greater_than', threshold: 0.5, minimumSample: 20 },
      { metric: 'friend_adds', operator: 'decrease_percent', threshold: 20, minimumSample: 20 },
      { metric: 'conversions', operator: 'zero_streak_days', threshold: 3, minimumSample: 20 },
    ])
  })

  it('しきい値と最低件数を変えると、変えた値で保存される', async () => {
    fixture.editId = 'report-1'
    await render()

    // 編集で開くと保存済みの値が入っている。
    expect(numberInput('ブロック率のしきい値（%）').value).toBe('0.5')
    await typeNumber('ブロック率のしきい値（%）', '1.5')
    await typeNumber('ブロック条件の判定に必要な最低件数', '50')

    await act(async () => { button('変更を保存する').click(); await Promise.resolve() })
    const put = writeCalls('PUT').at(-1)
    expect((put?.body as { alertRules: unknown[] }).alertRules).toContainEqual(
      { metric: 'block_rate', operator: 'greater_than', threshold: 1.5, minimumSample: 50 },
    )
  })

  it('条件ごとのon/offで、その条件だけ送らなくなる', async () => {
    await render()
    const toggle = host.querySelector('input[aria-label="友だち減少の条件を使う"]') as HTMLInputElement | null
    expect(toggle).not.toBeNull()
    await act(async () => { toggle!.click(); await Promise.resolve() })

    const personCheck = Array.from(host.querySelectorAll('input[type="checkbox"]')).find((item) => !(item as HTMLInputElement).disabled && item.closest('label')?.textContent?.includes('テスト')) as HTMLInputElement
    await act(async () => { personCheck.click(); await Promise.resolve() })
    await act(async () => { button('つくって動かす').click(); await Promise.resolve() })

    const post = writeCalls('POST').at(-1)
    const rules = (post?.body as { alertRules: Array<{ metric: string }> }).alertRules
    expect(rules.map((rule) => rule.metric)).toEqual(['block_rate', 'conversions'])
  })

  it('全部外したまま「知らせる」のときは止め、変な数も送らない', async () => {
    await render()

    for (const label of [
      'ブロック増の条件を使う',
      '友だち減少の条件を使う',
      '成果0件がつづく条件を使う',
    ]) {
      const toggle = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
      await act(async () => { toggle.click(); await Promise.resolve() })
    }
    const personCheck = Array.from(host.querySelectorAll('input[type="checkbox"]')).find((item) => !(item as HTMLInputElement).disabled && item.closest('label')?.textContent?.includes('テスト')) as HTMLInputElement
    await act(async () => { personCheck.click(); await Promise.resolve() })

    await act(async () => { button('つくって動かす').click(); await Promise.resolve() })
    expect(host.textContent).toContain('知らせる条件を1つ以上えらぶか')
    expect(writeCalls('POST')).toHaveLength(0)

    // 条件を戻してから変な数を入れても止まる。
    const toggle = host.querySelector('input[aria-label="ブロック増の条件を使う"]') as HTMLInputElement
    await act(async () => { toggle.click(); await Promise.resolve() })
    await typeNumber('ブロック率のしきい値（%）', '-1')
    await act(async () => { button('つくって動かす').click(); await Promise.resolve() })
    expect(host.textContent).toContain('0以上の数と1以上の件数で入力してください')
    expect(writeCalls('POST')).toHaveLength(0)
  })

  it('画面に無い決めごとは、編集して保存してもそのまま残る', async () => {
    fixtureSchedule.value = schedule({
      alertRules: [
        { metric: 'block_rate', operator: 'greater_than', threshold: 0.5, minimumSample: 20 },
        // この画面に出せない組み合わせ。編集のたびに消えてはいけない。
        { metric: 'conversions', operator: 'greater_than', threshold: 2, minimumSample: 5 },
      ],
    })
    fixture.editId = 'report-1'
    await render()

    await act(async () => { button('変更を保存する').click(); await Promise.resolve() })
    const put = writeCalls('PUT').at(-1)
    const rules = (put?.body as { alertRules: Array<{ metric: string; operator: string }> }).alertRules
    expect(rules).toContainEqual({ metric: 'conversions', operator: 'greater_than', threshold: 2, minimumSample: 5 })
    expect(rules).toContainEqual({ metric: 'block_rate', operator: 'greater_than', threshold: 0.5, minimumSample: 20 })
  })
})
