// @vitest-environment happy-dom
/*
 * V8 オートメーションの見本（c7dxp）の動きの試験。BEHAVIOR.md の「見本」の節を守る。
 * きっかけの札（先に出てきた順に6つまで・かっこの補足はまとめる）、見本から下書きを作る、
 * 閲覧のみでは押せない「この見本で下書きを作る」「見本から作る」を置かない。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/automations',
  useSearchParams: () => new URLSearchParams('tab=templates'),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

import AutomationTemplatesV8, { templateTriggerChips, templateTriggerGroup, templateTriggerText } from './templates'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const template = (key: string, name: string, triggerLabel: string) => ({ key, name, description: '', triggerLabel, actionLabel: 'メッセージを送る' })
const templates = [
  template('a', '友だち追加のあいさつ', '友だちになったとき'),
  template('b', '「予約」と送られたら担当へ', 'メッセージを受け取ったとき（含まれる言葉）'),
  template('c', 'VIP タグでシナリオ開始', 'タグが付いたとき'),
  template('d', 'アンケートの回答でタグ', 'フォームに答えたとき'),
  template('e', '予約のお礼', '予約が確定したとき'),
  template('f', '購入のお礼', '注文が確定したとき'),
  template('g', '初回購入でマイル', '注文が確定したとき（初回）'),
  template('h', '発送のお知らせ', '注文が発送されたとき'),
]

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const posted: string[] = []

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  role.value = 'owner'
  push.mockReset()
  posted.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (init?.method === 'POST' && url.pathname.startsWith('/api/automation-templates/')) {
      posted.push(url.pathname)
      return json({ success: true, data: { id: 'draft-1', draftVersionId: 'draft-1-v1' } }, 201)
    }
    if (url.pathname === '/api/automation-templates') return json({ success: true, data: templates })
    if (url.pathname === '/api/automations') {
      return json({ success: true, data: [], summary: { active: 0, stopped: 0, executionCount30d: 0, failureCount30d: 0 } })
    }
    if (url.pathname === '/api/automation-runs') return json({ success: true, data: { summary: { skipped: 0 } } })
    if (url.pathname === '/api/common-actions') return json({ success: true, data: [] })
    return json({ success: true, data: null })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

async function render() {
  await act(async () => { root.render(<AutomationTemplatesV8 />) })
  for (let i = 0; i < 60 && !(host.textContent ?? '').includes('友だち追加のあいさつ'); i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })
  }
}

const buttons = () => [...host.querySelectorAll('button, a')] as HTMLElement[]
const named = (text: string) => buttons().filter((element) => (element.textContent ?? '').trim() === text)
const chipLabels = () => [...host.querySelectorAll('[aria-label="きっかけで絞り込む"] button')].map((element) => (element.textContent ?? '').trim())

describe('きっかけの言い方と札', () => {
  it('「とき」を落とし、かっこの補足は同じ札にまとめる', () => {
    expect(templateTriggerText('友だちになったとき')).toBe('友だちになった')
    expect(templateTriggerText('メッセージを受け取ったとき（含まれる言葉）')).toBe('メッセージを受け取った（含まれる言葉）')
    expect(templateTriggerGroup('注文が確定したとき（初回）')).toBe('注文が確定した')
  })

  it('札は先に出てきた順に6つまで（7つ目以降は「すべて」から見る）', () => {
    expect(templateTriggerChips(templates)).toEqual([
      '友だちになった', 'メッセージを受け取った', 'タグが付いた', 'フォームに答えた', '予約が確定した', '注文が確定した',
    ])
  })
})

describe('V8 オートメーションの見本（c7dxp）', () => {
  it('タブ・札・カードを出し、札で絞り込める', async () => {
    await render()
    expect(host.querySelector('[data-design-node="c7dxp"]')).not.toBeNull()
    expect(chipLabels()).toEqual([
      'すべて 8', '友だちになった', 'メッセージを受け取った', 'タグが付いた', 'フォームに答えた', '予約が確定した', '注文が確定した',
    ])
    expect(host.querySelectorAll('li')).toHaveLength(8)
    expect(host.textContent).toContain('メッセージを受け取った（含まれる言葉）')

    await act(async () => { named('注文が確定した')[0]!.click() })
    const names = [...host.querySelectorAll('li h2')].map((element) => element.textContent)
    expect(names).toEqual(['購入のお礼', '初回購入でマイル'])
  })

  it('「この見本で下書きを作る」で見本から下書きを作り、下書きを仕上げる画面へ進む', async () => {
    await render()
    expect(named('この見本で下書きを作る')).toHaveLength(8)
    await act(async () => { named('この見本で下書きを作る')[0]!.click() })
    for (let i = 0; i < 40 && push.mock.calls.length === 0; i += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })
    }
    expect(posted).toEqual(['/api/automation-templates/a/drafts'])
    expect(push).toHaveBeenCalledWith('/automations/drafts?id=draft-1')
  })

  it('閲覧のみでは、帯を出し、下書きを作る・見本から作るを置かない（押せないボタンも無い）', async () => {
    role.value = 'viewer'
    await render()
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(named('この見本で下書きを作る')).toHaveLength(0)
    expect(named('見本から作る')).toHaveLength(0)
    expect(host.querySelectorAll('li')).toHaveLength(8)
  })
})
