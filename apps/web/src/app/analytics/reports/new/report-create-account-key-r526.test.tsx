// @vitest-environment happy-dom
/*
 * R526: 定期レポート作成の要求キーは、選んでいるアカウントに結びつける。
 *
 * 裏側は要求キーをそのまま行の主キーにする（全アカウントで1つ）。
 * Aで応答を失ったキーをBで使い回すと、Bには同キーが見つからず
 * INSERTで主キーが衝突して500になる。画面はアカウントが違えば
 * 新しいキーにし、同じアカウントの押し直しは同じキーで送る。
 *
 * 通信（fetch）だけを差し替え、本物のReact・本物の効果・本物の
 * クリックで、送った Idempotency-Key を見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
const pushed = vi.hoisted(() => [] as string[])
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { pushed.push(href) } }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/analytics/reports/new',
}))
/** 画面上部のアカウント切替と同じcontext。試験の途中で選択を変える。 */
const account = vi.hoisted(() => ({ id: 'account-a' as string | null }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: account.id, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageChrome: () => ({ title: null, fullWidth: false }),
}))

const OPTIONS = {
  timeZone: 'Asia/Tokyo',
  savedAnalyses: [],
  recipients: [{ id: 'staff-1', name: '山田', role: 'staff', email: 'y@example.com', lineLinked: true }],
}

/* 送った作成の記録。account_id と Idempotency-Key を控える。 */
const posted = vi.hoisted(() => [] as Array<{ accountId: string; key: string | null }>)
/* POST作成の振る舞い。'fail'は応答消失（通信エラー）、'manual'は止めておいて試験から解決する。 */
const postMode = vi.hoisted(() => ({ current: 'fail' as 'fail' | 'manual' }))
const pendingPosts = vi.hoisted(() => [] as Array<{
  accountId: string
  key: string | null
  resolve: (value: Response) => void
  reject: (reason?: unknown) => void
}>)

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string; headers?: Record<string, string> }) => {
    const raw = typeof input === 'string' ? input : String(input)
    const url = new URL(raw.startsWith('http') ? raw : `https://worker.example.com${raw}`)
    if (url.pathname === '/api/staff/me') {
      return new Response(JSON.stringify({ success: true, data: { role: 'owner' } }), { status: 200 })
    }
    if (url.pathname === '/api/analytics/report-schedules' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ success: true, data: { items: [], options: OPTIONS } }), { status: 200 })
    }
    if (url.pathname === '/api/analytics/report-schedules' && init?.method === 'POST') {
      const entry = {
        accountId: url.searchParams.get('account_id') ?? '',
        key: init?.headers?.['Idempotency-Key'] ?? null,
      }
      if (postMode.current === 'manual') {
        return new Promise<Response>((resolve, reject) => {
          pendingPosts.push({ ...entry, resolve, reject })
        })
      }
      posted.push(entry)
      throw new Error('network down')
    }
    return new Response(JSON.stringify({ success: false, error: '未設定' }), { status: 500 })
  })
}

import AnalyticsReportNewPage from './page'

let container: HTMLDivElement
let root: Root

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<AnalyticsReportNewPage />) })
}

async function rerender() {
  await act(async () => { root.render(<AnalyticsReportNewPage />) })
}

/** 効果と通信が落ち着くまで回す。 */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {})
  }
}

function hasText(text: string): boolean {
  return (container.textContent ?? '').includes(text)
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === text,
  )
  if (!found) throw new Error(`「${text}」のボタンが見つかりません`)
  return found as HTMLButtonElement
}

/** 宛先の行リストから、名前の行のチェックを付ける。 */
async function checkRecipient(name: string) {
  const label = [...container.querySelectorAll('li')].find(
    (li) => (li.textContent ?? '').includes(name),
  )
  const input = label?.querySelector('input[type="checkbox"]')
  if (!input) throw new Error(`宛先「${name}」が見つかりません`)
  await act(async () => { fireEvent.click(input) })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  pushed.length = 0
  posted.length = 0
  pendingPosts.length = 0
  postMode.current = 'fail'
  account.id = 'account-a'
  installFetch()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('定期レポート作成の要求キー（R526）', () => {
  it('Aで応答を失ったキーをBで使い回さない。Bは新しいキーで作る', async () => {
    await mount()
    await settle()
    expect(hasText('山田')).toBe(true)

    await checkRecipient('山田')
    await click(buttonByText('つくって動かす'))
    await settle()

    // Aへの作成は通信エラーで失われた（結果へ進まない）。キーは控えてある。
    expect(posted).toHaveLength(1)
    expect(posted[0].accountId).toBe('account-a')
    const keyA = posted[0].key
    expect(typeof keyA).toBe('string')
    expect(pushed).toHaveLength(0)

    // 別アカウントへ切り替えて作り直す。
    account.id = 'account-b'
    await rerender()
    await settle()
    expect(hasText('山田')).toBe(true)
    await click(buttonByText('つくって動かす'))
    await settle()

    // Bへの作成はAのキーと別物。使い回すと裏側の主キーが衝突して500になる。
    expect(posted).toHaveLength(2)
    expect(posted[1].accountId).toBe('account-b')
    expect(posted[1].key).toBeTruthy()
    expect(posted[1].key).not.toBe(keyA)
  })

  it('Aで応答を失いBで作ってAへ戻っても、Aの押し直しはAのキーで送る（R526）', async () => {
    await mount()
    await settle()
    expect(hasText('山田')).toBe(true)

    await checkRecipient('山田')
    await click(buttonByText('つくって動かす'))
    await settle()
    const keyA = posted[0].key
    expect(keyA).toBeTruthy()

    account.id = 'account-b'
    await rerender()
    await settle()
    await click(buttonByText('つくって動かす'))
    await settle()
    const keyB = posted[1].key
    expect(keyB).toBeTruthy()
    expect(keyB).not.toBe(keyA)

    // Aへ戻って押し直す。Bの試行で上書きされていたら別物になり、Aに二重予約ができる。
    account.id = 'account-a'
    await rerender()
    await settle()
    await click(buttonByText('つくって動かす'))
    await settle()

    expect(posted).toHaveLength(3)
    expect(posted[2].accountId).toBe('account-a')
    expect(posted[2].key).toBe(keyA)
  })

  it('Aの作成が終わらないうちにBへ移ってもBは止まらない。遅れたAの成功はBを上書きしない（R526）', async () => {
    postMode.current = 'manual'
    await mount()
    await settle()
    expect(hasText('山田')).toBe(true)

    await checkRecipient('山田')
    await click(buttonByText('つくって動かす'))
    await settle()
    expect(pendingPosts).toHaveLength(1)
    const keyA = pendingPosts[0].key
    expect(keyA).toBeTruthy()

    // Bへ移る。Aの進行表示に引きずられず、Bはすぐ作れる。
    account.id = 'account-b'
    await rerender()
    await settle()
    expect(buttonByText('つくって動かす').disabled).toBe(false)

    // 遅れてAの成功が戻っても、Bの画面はそのまま（結果へ飛ばない・文も変わらない）。
    await act(async () => {
      pendingPosts[0].resolve(new Response(
        JSON.stringify({ success: true, data: { id: 'sched-a' } }), { status: 201 },
      ))
    })
    await settle()
    expect(pushed).toHaveLength(0)
    expect(hasText('山田')).toBe(true)
    expect(buttonByText('つくって動かす').disabled).toBe(false)

    // Bの作成はAと別のキーで送る。
    await click(buttonByText('つくって動かす'))
    await settle()
    expect(pendingPosts).toHaveLength(2)
    expect(pendingPosts[1].accountId).toBe('account-b')
    expect(pendingPosts[1].key).toBeTruthy()
    expect(pendingPosts[1].key).not.toBe(keyA)
    expect(pushed).toHaveLength(0)
  })

  it('同じアカウントの押し直しは同じキーで送る（二重予約にしない）', async () => {
    await mount()
    await settle()
    expect(hasText('山田')).toBe(true)

    await checkRecipient('山田')
    await click(buttonByText('つくって動かす'))
    await settle()
    await click(buttonByText('つくって動かす'))
    await settle()

    expect(posted).toHaveLength(2)
    expect(posted[0].accountId).toBe('account-a')
    expect(posted[1].accountId).toBe('account-a')
    expect(posted[1].key).toBe(posted[0].key)
  })
})
