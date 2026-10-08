// @vitest-environment happy-dom
/*
 * 監査 WEB040/041：流入と計測のサイトスクリプト・広告とのつなぎで、アカウントを
 * 切り替えたあとに前のアカウントの遅い応答・保存の結果が今の画面に入らない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const acc = vi.hoisted(() => ({ id: 'account-a' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/inflow-links',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: acc.id, accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

import SiteScriptV8 from './site-script'
import AdConnectionsV8 from './ad-connections'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const site = (id: string, label: string) => ({
  id, label, domains: [`${id}.example`], status: 'active', lastSeenAt: null, stoppedAt: null, stoppedReason: null, version: 1,
})

let root: Root
let host: HTMLDivElement
let handler: (url: URL, method: string) => Promise<Response>

beforeEach(() => {
  acc.id = 'account-a'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init?.method ?? 'GET'))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function settle() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('サイトスクリプト（WEB040）', () => {
  it('WEB039 ページの visitors を訪問者数として表示し、説明で定義を示す', async () => {
    handler = async (url) => {
      if (url.pathname.includes('measurement-sites')) return json({ success: true, data: [site('sa', 'Aのサイト')] });
      if (url.pathname.includes('summary')) return json({ success: true, data: { lastEventAt: '2026-10-08T10:00:00Z' } });
      if (url.pathname.includes('pages')) return json({ success: true, data: [{ host: 'sa.example', path: '/shop', views: 17, visitors: 4 }] });
      return json({ success: false, error: 'x' }, 404);
    };
    await act(async () => { root.render(<SiteScriptV8 />) });
    await settle();
    const header = [...host.querySelectorAll('[role="columnheader"]')].find((el) => el.textContent?.includes('訪問者数'));
    expect(header).toBeTruthy();
    expect(header?.closest('[role="table"]')?.textContent).toContain('4');
    const help = host.querySelector('button[aria-label="訪問者数の説明"]') as HTMLButtonElement;
    expect(help).toBeTruthy();
    await act(async () => { help.click() });
    expect(document.body.textContent).toContain('同じ訪問者は1人として数えます');
    expect(document.body.textContent).toContain('LINEの友だち追加数は含みません');
  });

  it('B に切り替えたあとに A のサイト一覧が届いても、B のサイトのまま', async () => {
    let releaseA: () => void = () => undefined
    handler = async (url) => {
      const account = url.searchParams.get('accountId') ?? url.searchParams.get('account_id') ?? url.searchParams.get('lineAccountId')
      if (url.pathname.includes('measurement-sites')) {
        if (account === 'account-a') await new Promise<void>((resolve) => { releaseA = resolve })
        return json({ success: true, data: [site(account === 'account-a' ? 'sa' : 'sb', account === 'account-a' ? 'Aのサイト' : 'Bのサイト')] })
      }
      if (url.pathname.includes('summary')) return json({ success: true, data: { lastEventAt: null } })
      if (url.pathname.includes('pages')) return json({ success: true, data: [] })
      return json({ success: false, error: 'x' }, 404)
    }
    await act(async () => { root.render(<SiteScriptV8 />) })
    await settle()
    acc.id = 'account-b'
    await act(async () => { root.render(<SiteScriptV8 />) })
    await settle()
    expect(host.textContent).toContain('Bのサイト')
    await act(async () => { releaseA() })
    await settle()
    expect(host.textContent).not.toContain('Aのサイト')
  })
})

describe('広告とのつなぎ（WEB041）', () => {
  it('A で押した保存の結果で、B の対応表を A の対応表へ戻さない', async () => {
    let releasePut: () => void = () => undefined
    const mapping = (name: string) => [{
      pointId: 'cp-1', pointName: name, eventType: 'x', provider: 'meta', mode: 'off', eventName: null,
      automaticEventName: 'Schedule', googleActionId: null, version: 3,
    }]
    handler = async (url, method) => {
      if (method === 'PUT') {
        await new Promise<void>((resolve) => { releasePut = resolve })
        return json({ success: true, data: null })
      }
      if (url.pathname === '/api/ad-platforms/mappings') {
        const account = url.searchParams.get('account_id') ?? url.searchParams.get('accountId')
        return json({ success: true, data: mapping(account === 'account-a' ? 'Aの成果地点' : 'Bの成果地点') })
      }
      if (url.pathname === '/api/ad-platforms/logs') {
        return json({ success: true, data: { items: [], total: 0, page: 1, limit: 20, summary: { sentLast30Days: 0, pendingLast30Days: 0, failedLast30Days: 0 }, sort: [] } })
      }
      if (url.pathname === '/api/ad-platforms') return json({ success: true, data: [] })
      return json({ success: true, data: null })
    }
    await act(async () => { root.render(<AdConnectionsV8 />) })
    await settle()
    expect(host.textContent).toContain('Aの成果地点')
    const select = host.querySelector('button[aria-label="Aの成果地点をMeta広告に返す名前"]') as HTMLElement
    await act(async () => { select.click() })
    const option = [...document.querySelectorAll('[role="option"]')].find((element) => element.textContent?.includes('自動で返す')) as HTMLElement
    await act(async () => { (option.querySelector('button') ?? option).click() })
    await settle()
    acc.id = 'account-b'
    await act(async () => { root.render(<AdConnectionsV8 />) })
    await settle()
    expect(host.textContent).toContain('Bの成果地点')
    await act(async () => { releasePut() })
    await settle()
    expect(host.textContent).toContain('Bの成果地点')
    expect(host.textContent).not.toContain('Aの成果地点')
  })
})
