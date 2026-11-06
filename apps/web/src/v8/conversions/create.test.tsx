// @vitest-environment happy-dom
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
/*
 * V8 成果地点を作る（src/v8/conversions/create.tsx）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 同じ名前の成果地点があると競合の帯と「比べてから保存」・保存が 409 で返ったときも帯・
 * 送る形（使う場所は種類の行のチェックで全部）・閲覧のみは保存ボタンを置かない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversionDefinitionPreview } from '@/lib/api'
import ConversionCreateV8 from './create'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const query = vi.hoisted(() => ({ value: '' }))
const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/conversions/new',
  useSearchParams: () => new URLSearchParams(query.value),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const posted: Array<Record<string, unknown>> = []
let createStatus = 200

let root: Root
let host: HTMLDivElement

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function mount() {
  await act(async () => { root.render(<ConversionCreateV8 />) })
  await flush()
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  role.value = verifiedStaffRole('owner')
  query.value = ''
  push.mockReset()
  posted.length = 0
  createStatus = 200
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.pathname === '/api/conversions/points') {
      return json({ success: true, data: [{ id: 'cp-1', name: '商品を買った', eventType: 'ec_order_confirmed', value: null, lineAccountId: null, version: 1, createdAt: '' }] })
    }
    if (method === 'POST' && url.pathname === '/api/conversions/definitions') {
      posted.push(JSON.parse(String(init?.body ?? '{}')))
      if (createStatus === 409) return json({ success: false, error: '同じ名前の成果地点があります' }, 409)
      return json({ success: true, data: { id: 'cp-new' } })
    }
    if (url.pathname === '/api/conversions/definitions/preview') {
      return json({ success: true, data: {
        range: { from: '2026-09-01', to: '2026-09-30', timeZone: 'Asia/Tokyo' },
        matchedCount: 52, estimatedCount: 52, estimatedValue: 412000,
        duplicateExcludedCount: 2, cancellationCount: 1, excludedReasons: [],
        missingValueCount: 0, dailyAverage: 2, deduplicationWindowDays: null,
      } satisfies ConversionDefinitionPreview })
    }
    if (url.pathname.endsWith('/api/automations')) {
      return json({ success: true, data: [{ id: 'auto-1', name: '初回注文をSlackへ知らせる', versionId: 'v1' }, { id: 'auto-2', name: '体験申込のフォロー', versionId: 'v2' }] })
    }
    return json({ success: true, data: [] })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

const nameInput = () => screen.getByLabelText('成果地点の名前') as HTMLInputElement

describe('V8 成果地点を作る', () => {
  it('名前が空なら欄の下だけで理由を知らせ、名前へ移り、保存しない', async () => {
    await mount()
    const scroll = vi.fn()
    nameInput().scrollIntoView = scroll
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await flush()
    expect(nameInput().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(nameInput())
    expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    const error = screen.getByRole('alert')
    expect(error.textContent).toBe('成果地点の名前を入力してください')
    expect(nameInput().getAttribute('aria-describedby')?.split(/\s+/)).toContain(error.id)
    expect(error.closest('[data-template-region="content"]')).toBeTruthy()
    expect(screen.getAllByText('成果地点の名前を入力してください')).toHaveLength(1)
    expect(posted).toHaveLength(0)
    fireEvent.change(nameInput(), { target: { value: '定期便を始めた' } })
    await flush()
    expect(nameInput().getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('詳細設定の期間が正しくなければ、閉じた段を開いて期間の欄へ移る', async () => {
    await mount()
    fireEvent.change(nameInput(), { target: { value: '定期便を始めた' } })
    const days = screen.getByLabelText('友だち追加からの計測期間') as HTMLInputElement
    fireEvent.change(days, { target: { value: '366' } })
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await flush()
    expect(days.getAttribute('aria-invalid')).toBe('true')
    expect(days.closest('details')?.open).toBe(true)
    expect(document.activeElement).toBe(days)
    expect(screen.getByRole('alert').textContent).toBe('成果を紐づける日数は1〜365日で入力してください')
    expect(posted).toHaveLength(0)
  })

  it('?name= で同じ名前の成果地点があると、競合の帯と「比べてから保存」を出す（cXqlS）', async () => {
    query.value = 'name=商品を買った'
    await mount()
    expect(nameInput().value).toBe('商品を買った')
    expect(screen.getByRole('alert').textContent).toContain('同じ名前の「商品を買った」がすでにあります')
    expect(screen.getByRole('link', { name: /違いを比べる/ }).getAttribute('href')).toBe('/affiliates?tab=points&highlight=cp-1')
    expect(screen.getByRole('link', { name: /比べてから保存/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /保存して数えはじめる/ })).toBeNull()
  })

  it('保存が 409 で返ったら、上書きせずに帯を出す', async () => {
    createStatus = 409
    await mount()
    fireEvent.change(nameInput(), { target: { value: '定期便を始めた' } })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await flush()
    expect(posted).toHaveLength(1)
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('ほかの人が「定期便を始めた」を先に保存しました')
  })

  it('種類の行のチェックで、その種類の候補を全部「使う場所」として送り、一覧の作った行へ戻る', async () => {
    await mount()
    fireEvent.change(nameInput(), { target: { value: '定期便を始めた' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '自動化（オートメーション）' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    // 送るまでの待ちの回数は混み具合で変わる。決まった回数ではなく、送られるまで待つ（CI で混むと落ちていた）。
    await waitFor(() => expect(posted.length).toBe(1))
    expect(posted[0].name).toBe('定期便を始めた')
    expect(posted[0].usages).toEqual([
      { refKind: 'automation', refId: 'auto-1', refVersionId: 'v1' },
      { refKind: 'automation', refId: 'auto-2', refVersionId: 'v2' },
    ])
    await waitFor(() => expect(push).toHaveBeenCalledWith('/affiliates?tab=points&highlight=cp-new'))
  })

  it('閲覧のみ：帯を出し、保存のボタン・使う場所を足すは置かない', async () => {
    role.value = verifiedStaffRole('staff')
    await mount()
    expect(screen.getByText('閲覧のみで見ています。作る操作はオーナーか管理者に頼んでください。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /保存して/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /使う場所を足す/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'キャンセル' }).getAttribute('href')).toBe('/affiliates?tab=points')
    // 押せない入力の欄も置かない（作る画面なので帯だけ）
    expect(screen.queryByLabelText('成果地点の名前')).toBeNull()
  })
})

/* 口の返事を1つだけ差し替える（ほかは上の既定のまま）。 */
function overrideFetch(handler: (url: URL, init?: RequestInit) => Response | null) {
  const base = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init) ?? base(input, init))
}

async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(within(screen.getByRole('option', { name: option })).getByRole('button'))
  await flush()
}

describe('V8 成果地点を作る：送る形と確かめ', () => {
  it('使う場所の候補は実在する分析とNEN配信の一覧から読み、その実IDを送る', async () => {
    overrideFetch((url) => {
      if (url.pathname === '/api/analytics/funnels') {
        return json({ success: true, data: [{ id: 'fn-7', name: '購入までの流れ', windowDays: 30, createdAt: '', status: 'active', currentVersion: { id: 'fv-3', versionNumber: 3, createdAt: '' }, migrationState: 'ready' }] })
      }
      if (url.pathname === '/api/nen-campaigns/settings') {
        return json({ success: true, data: [{ campaignKey: 'spring-sale', label: '春のセール' }] })
      }
      return null
    })
    await mount()
    fireEvent.change(nameInput(), { target: { value: '定期便を始めた' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '分析（ファネル・レポート）' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'NEN配信' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await waitFor(() => expect(posted.length).toBe(1))
    expect(posted[0].usages).toEqual([
      { refKind: 'analytics', refId: 'fn-7', refVersionId: 'fv-3' },
      { refKind: 'nen_campaign', refId: 'spring-sale' },
    ])
  })

  it('起点・数え方・取り消しの扱いを選んだとおりに定義の口へ送る', async () => {
    await mount()
    fireEvent.change(nameInput(), { target: { value: '動画を最後まで見た' } })
    await choose('できごと', '動画を見終えた（ウェビナー）')
    fireEvent.click(screen.getByRole('radio', { name: /30日に1回まで/ }))
    await choose('取り消されたとき', '件数と金額を引く')
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await waitFor(() => expect(posted.length).toBe(1))
    expect(posted[0]).toMatchObject({
      name: '動画を最後まで見た',
      sourceType: 'webinar_completed',
      deduplicationMode: 'window',
      deduplicationWindowDays: 30,
      reversalPolicy: 'source_cancelled',
    })
  })

  it('タグ起点はタグとして送り、注文起点だけが「注文の金額」を選べる', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '金額の出し方' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toContain('注文の金額')
    fireEvent.click(screen.getByRole('button', { name: '金額の出し方' }))
    fireEvent.change(nameInput(), { target: { value: 'タグが付いた' } })
    await choose('できごと', 'タグが付いた（タグ）')
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await waitFor(() => expect(posted.length).toBe(1))
    expect(posted[0].sourceType).toBe('tag_added')
    expect(posted[0].valueMode).not.toBe('source')
  })

  it('数え方の3択は一覧と同じ呼び名の札で出す', async () => {
    await mount()
    const names = (screen.getAllByRole('radio') as HTMLInputElement[])
      .filter((radio) => radio.name === 'conversion-create-dedup')
      .map((radio) => radio.closest('label')?.textContent ?? '')
    expect(names.map((name) => name.split(/はじめて|短い間|買うたび/)[0])).toEqual(['1人1回だけ', '30日に1回まで', '何回でも'])
  })

  it('決まった額がマイナスなら保存の口と同じ条件を先に言い、送らない', async () => {
    await mount()
    fireEvent.change(nameInput(), { target: { value: '定期便を始めた' } })
    await choose('金額の出し方', '決まった額')
    fireEvent.change(screen.getByLabelText('決まった金額'), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('固定で付ける金額は0以上の数値で入力してください')
    expect(posted).toHaveLength(0)
  })

  it('同じ名前の警告は同じ集計対象の中だけで出し、二重に数える理由を添える', async () => {
    overrideFetch((url) => (url.pathname === '/api/conversions/points'
      ? json({ success: true, data: [
          { id: 'cp-b', name: '別の店の購入', eventType: 'ec_order_confirmed', value: null, lineAccountId: 'account-b', version: 1, createdAt: '' },
          { id: 'cp-a', name: 'この店の購入', eventType: 'ec_order_confirmed', value: null, lineAccountId: 'account-a', version: 1, createdAt: '' },
        ] })
      : null))
    await mount()
    fireEvent.change(nameInput(), { target: { value: '別の店の購入' } })
    await flush()
    expect(screen.queryByText(/がすでにあります/)).toBeNull()
    fireEvent.change(nameInput(), { target: { value: 'この店の購入' } })
    await flush()
    expect(screen.getByText('同じ名前の「この店の購入」がすでにあります')).toBeTruthy()
    expect(screen.getByText('このまま保存すると、同じ意味の成果地点が2つになり、分析の数字が二重になります')).toBeTruthy()
  })

  it('試算は入力中の条件で口を呼び、除いた理由を出し、成果を追加しないと断る', async () => {
    const previews: Array<Record<string, unknown>> = []
    overrideFetch((url, init) => {
      if (url.pathname !== '/api/conversions/definitions/preview') return null
      previews.push(JSON.parse(String(init?.body ?? '{}')))
      return json({ success: true, data: {
        range: { from: '2026-09-01', to: '2026-09-30', timeZone: 'Asia/Tokyo' },
        matchedCount: 10, estimatedCount: 8, estimatedValue: 8000,
        duplicateExcludedCount: 1, cancellationCount: 1, excludedReasons: ['テスト用の注文を除きました'],
        missingValueCount: 0, dailyAverage: 1, deduplicationWindowDays: 30,
      } satisfies ConversionDefinitionPreview })
    })
    await mount()
    await choose('できごと', '予約が確定した（予約管理）')
    await waitFor(() => expect(previews.at(-1)?.sourceType).toBe('reservation_confirmed'))
    expect(posted).toHaveLength(0)
    await waitFor(() => expect(screen.getByText('テスト用の注文を除きました')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'この試算の説明' }))
    const note = screen.getByRole('note').textContent ?? ''
    expect(note).toContain('入力中の条件だけで試算しています。')
    expect(note).toContain('試算では成果を追加しません。')
  })
})

afterEach(() => { verifiedStaffRole(null) })
