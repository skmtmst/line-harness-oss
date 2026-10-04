// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsAnnouncementsPage from './page'
import { previewLabel, toLocalInput, toPublishAt } from './format'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/ops/announcements',
  useRouter: () => ({ push: navigation.push, replace: vi.fn(), back: vi.fn() }),
}))

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは選んだ後の配信予約の判断なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

/** ★V6 37-7 お知らせ配信。作成欄・送り方・宛先の見込み・一覧（LINE送達／画面で既読）が API の形どおりに出ること。 */

const sent = {
  id: 'a1', subject: '9月20日 深夜のメンテナンスのお知らせ', body: '本文', audienceKind: 'all', audiencePlans: [], audienceTenantIds: [],
  audienceLabel: '全契約先', channels: ['line', 'screen', 'email'], channelLabels: ['LINE', '画面', 'メール'], status: 'sent', statusLabel: '送信済み',
  publishAt: null, sentAt: '2026-09-17T10:00:00.000+09:00', recipientsTotal: 24, lineSent: 21, lineFailed: 0, mailSent: 24, mailFailed: 0,
  screenRead: 5, screenTotal: 24, lastError: null, createdByName: '運営 太郎', createdAt: '2026-09-17T09:00:00.000+09:00', updatedAt: '2026-09-17T10:00:00.000+09:00',
}
const draft = { ...sent, id: 'a2', subject: '料金改定のご案内（下書き）', status: 'draft', statusLabel: '下書き', sentAt: null, recipientsTotal: 0, lineSent: 0, mailSent: 0, screenRead: 0, screenTotal: 0 }

let host: HTMLDivElement
let root: Root
let calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }>
let lineConfigured = true
let announcements: unknown[] = []
/** M513: PUT の応答を差し替えて競合を起こす（null のときは通常応答）。 */
let putOverride: { status: number; payload: unknown } | null = null

beforeEach(() => {
  calls = []
  lineConfigured = true
  announcements = [sent, draft]
  putOverride = null
  navigation.push.mockClear()
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    const headers: Record<string, string> = {}
    const rawHeaders = init?.headers
    if (rawHeaders) {
      const entries = rawHeaders instanceof Headers ? rawHeaders.entries() : Object.entries(rawHeaders)
      for (const [key, value] of entries) headers[String(key).toLowerCase()] = String(value)
    }
    calls.push({ url, method, body, headers })
    if (putOverride && method === 'PUT' && url.includes('/api/ops/announcements/')) {
      return new Response(JSON.stringify(putOverride.payload), { status: putOverride.status, headers: { 'Content-Type': 'application/json' } })
    }
    let payload: unknown
    if (url.endsWith('/api/ops/announcements/preview')) payload = { success: true, data: { tenants: 12, staff: 24, lineLinked: 21, withEmail: 24 } }
    else if (url.endsWith('/api/ops/announcements') && method === 'POST') payload = { success: true, data: { ...sent, id: 'a3', recipientsTotal: 24, lineSent: 21, mailSent: 24 } }
    else if (url.endsWith('/api/ops/announcements')) payload = { success: true, data: announcements, linked: { linked: 21, total: 24 }, noticeLineConfigured: lineConfigured }
    else if (url.includes('/api/ops/tenants')) payload = { success: true, data: [] }
    else payload = { success: true, data: null }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('表記の決まり', () => {
  it('公開日時は日本時間の ISO に、宛先の見込みは送り方に合わせて出す', () => {
    expect(toPublishAt('2026-09-20T02:00')).toBe('2026-09-20T02:00:00+09:00')
    expect(toPublishAt('')).toBeNull()
    expect(toLocalInput('2026-09-20T02:00:00+09:00')).toBe('2026-09-20T02:00')
    expect(toLocalInput(null)).toBe('')
    expect(previewLabel(null, ['line'])).toBe('宛先を数えています…')
    expect(previewLabel({ tenants: 12, staff: 24, lineLinked: 21, withEmail: 24 }, ['line', 'email']))
      .toBe('12件の契約先・24人の権限者。うち契約者専用LINEに登録済みの21人へ届きます。メールは24人に届きます')
    expect(previewLabel({ tenants: 12, staff: 24, lineLinked: 21, withEmail: 24 }, ['screen'])).toBe('12件の契約先・24人の権限者')
  })
})

describe('画面', () => {
  it('一覧に状態・LINE送達・画面で既読が出て、下書きだけ直す／消すが出る', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    const text = host.textContent ?? ''
    expect(host.querySelector('button[aria-label="契約者専用LINEの登録状況"]')).not.toBeNull()
    expect(text).toContain('9月20日 深夜のメンテナンスのお知らせ')
    expect(text).toContain('送信済み')
    expect(text).toContain('21 / 24')
    expect(text).toContain('5 / 24')
    expect(text).toContain('下書き')
    expect(host.querySelector('button[aria-label="宛先の見込み"]')).not.toBeNull()
    expect(Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === '直す')).toHaveLength(1)
    expect(calls.some((c) => c.url.endsWith('/api/ops/announcements/preview') && c.method === 'POST')).toBe(true)
    expect(document.querySelector('[data-design-node="tQ2MJ"]')).not.toBeNull()
  })

  it('件名・本文を入れて「今すぐ送る」→確認の窓→送信。mode=send と送り方が API に渡る', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    const subject = document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!
    const body = document.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => { setValue(subject, 'メンテナンスのお知らせ'); setValue(body, '本文です') })
    await act(async () => { button('今すぐ送る')!.click() })
    await flush()
    // 板 `TJUUl`「送る前の確認」：宛先・届く方法・日時と件名・本文を見てから送る。
    const confirm = document.body.querySelector('[data-design-node="TJUUl"]')
    expect(confirm, '送る前の確認の窓が出ない').not.toBeNull()
    for (const row of ['このお知らせを送りますか？', '宛先', '届く方法', '送る日時', '件名：メンテナンスのお知らせ', '取り下げられます', '戻って直す', '今すぐ送る']) {
      expect(confirm?.textContent ?? '', `「${row}」がない`).toContain(row)
    }
    const sendInDialog = Array.from(confirm?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === '今すぐ送る')
    expect(sendInDialog, '小窓の中に送るボタンがない').not.toBeUndefined()
    await act(async () => { (sendInDialog as HTMLButtonElement).click() })
    await flush()
    const post = calls.find((c) => c.url.endsWith('/api/ops/announcements') && c.method === 'POST')!
    expect(post.body).toMatchObject({ subject: 'メンテナンスのお知らせ', body: '本文です', audienceKind: 'all', channels: ['line', 'screen'], mode: 'send', publishAt: null })
    expect(host.textContent).toContain('送りました（24人。LINE 21・メール 24）')
  })

  it('公開日時を入れると主ボタンが「配信を予約する」になり、mode=schedule で送る', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    await act(async () => {
      setValue(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!, '予約のお知らせ')
      setValue(document.querySelector<HTMLTextAreaElement>('textarea')!, '本文')
    })
    // 公開日時の選択（★V7）で今月の押せる日の 02:00 を選ぶ。値は今までどおり日本時間の文字列。
    // 固定の日付で指定すると、その日が今月の格子に出ない月の切り替わりで
    // 落ちる（月初境界で発生）。格子の中の押せる日をその都度選ぶ。
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="公開日時（日本時間）"]')!.click()
    })
    const picker = document.querySelector('[role="dialog"][aria-label="日時を選ぶ"]')!
    await act(async () => {
      picker.querySelector<HTMLButtonElement>('button[aria-label="日付"]')!.click()
    })
    let picked = ''
    await act(async () => {
      const day = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label]')).find((b) => {
        const label = b.getAttribute('aria-label') ?? ''
        return /^(\d{4})年(\d{1,2})月(\d{1,2})日（.）/.test(label) && b.getAttribute('aria-disabled') !== 'true' && !b.hasAttribute('data-outside')
      })!
      const match = day.getAttribute('aria-label')!.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/)!
      const pad2 = (n: string) => n.padStart(2, '0')
      picked = `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`
      day.click()
    })
    await act(async () => {
      const hour = picker.querySelector<HTMLSelectElement>('select[aria-label="時"]')!
      hour.value = '02'
      hour.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(button('今すぐ送る')).toBeUndefined()
    await act(async () => { button('配信を予約する')!.click() })
    await flush()
    const post = calls.find((c) => c.url.endsWith('/api/ops/announcements') && c.method === 'POST')!
    expect(post.body).toMatchObject({ mode: 'schedule', publishAt: `${picked}T02:00:00+09:00` })
  })

  it('契約者専用LINEが未設定なら注意を出し、LINE を含む送信は止める', async () => {
    lineConfigured = false
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    expect(host.textContent).toContain('契約者専用LINEのアカウントが未設定です')
    await act(async () => {
      setValue(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!, 'x')
      setValue(document.querySelector<HTMLTextAreaElement>('textarea')!, 'y')
    })
    await act(async () => { button('今すぐ送る')!.click() })
    await flush()
    const confirm = document.body.querySelector('[data-design-node="TJUUl"]')
    const sendInDialog = Array.from(confirm?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === '今すぐ送る') as HTMLButtonElement
    await act(async () => { sendInDialog.click() })
    await flush()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('契約者専用LINEのアカウントが未設定です。メンバー管理の「運営の情報」で指定してください')
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/ops/announcements'))).toBe(false)
  })

  it('未入力で保存を押しても一覧は失敗表示に変わらない（監査 R154）', async () => {
    announcements = []
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    expect(host.textContent).toContain('まだお知らせはありません')
    // 件名も本文も空のまま「下書きとして保存」→ 入力の検証エラー
    await act(async () => { button('下書きを保存する')!.click() })
    await flush()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('件名を入力してください')
    // 一覧は「読み込み失敗」に変わらず、空の案内のまま保つ
    expect(host.textContent).toContain('まだお知らせはありません')
    expect(host.textContent).not.toContain('お知らせを表示できませんでした')
  })

  it('入力中に画面内リンクを押すと離脱の確認が出て、「編集を続ける」で入力が残る（監査 R155）', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    await act(async () => {
      setValue(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!, '書きかけの件名')
    })
    // 左メニューなどの画面内リンクを踏むのと同じクリックを起こす
    const link = document.createElement('a')
    link.href = '/ops/knowledge'
    document.body.appendChild(link)
    await act(async () => { link.click() })
    await flush()
    link.remove()
    expect(document.body.textContent).toContain('保存していない変更があります')
    await act(async () => { button('編集を続ける')!.click() })
    await flush()
    expect(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!.value).toBe('書きかけの件名')
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('離脱の確認で「保存せずに移る」を押すと移動する（監査 R155）', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    await act(async () => {
      setValue(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!, '書きかけの件名')
    })
    const link = document.createElement('a')
    link.href = '/ops/knowledge'
    document.body.appendChild(link)
    await act(async () => { link.click() })
    await flush()
    link.remove()
    await act(async () => { button('保存せずに移る')!.click() })
    await flush()
    expect(navigation.push).toHaveBeenCalledWith('/ops/knowledge')
  })
})

describe('二重押しと同時保存（M512/M513）', () => {
  it('M512: 作成に再実行キー（UUID）を添えて送る', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    await act(async () => {
      setValue(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!, 'メンテナンスのお知らせ')
      setValue(document.querySelector<HTMLTextAreaElement>('textarea')!, '本文です')
    })
    await act(async () => { button('今すぐ送る')!.click() })
    await flush()
    const confirm = document.body.querySelector('[data-design-node="TJUUl"]')
    const sendInDialog = Array.from(confirm?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === '今すぐ送る') as HTMLButtonElement
    await act(async () => { sendInDialog.click() })
    await flush()
    const post = calls.find((c) => c.url.endsWith('/api/ops/announcements') && c.method === 'POST')!
    expect(post.headers['idempotency-key']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('M513: 直すときは開いたときの版を添え、競合時は入力を残したまま理由を出して読み直す', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    // 下書きの「直す」を押して編集に入る。
    await act(async () => { button('直す')!.click() })
    await flush()
    expect(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!.value).toContain('料金改定のご案内')
    await act(async () => {
      setValue(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!, '料金改定のご案内（修正）')
    })
    // ほかの人が先に保存した想定で409を返す。
    putOverride = {
      status: 409,
      payload: {
        success: false,
        code: 'VERSION_CONFLICT',
        error: 'ほかの人が先に保存しました。一覧を読み直してから、もう一度保存してください。',
        data: { latest: { subject: 'ほかの人の件名', updatedAt: '2026-09-18T00:00:00.000+09:00' } },
      },
    }
    await act(async () => { button('下書きを保存する')!.click() })
    await flush()
    const put = calls.find((c) => c.url.includes('/api/ops/announcements/a2') && c.method === 'PUT')!
    expect(put.body).toMatchObject({ subject: '料金改定のご案内（修正）', expectedUpdatedAt: '2026-09-17T10:00:00.000+09:00' })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('ほかの人が先に保存しました')
    // 入力は消えない。
    expect(document.querySelector<HTMLInputElement>('input[placeholder^="例："]')!.value).toBe('料金改定のご案内（修正）')
    // 一覧を読み直す（GET がもう一度呼ばれる）。
    expect(calls.filter((c) => c.url.endsWith('/api/ops/announcements') && c.method === 'GET')).toHaveLength(2)
  })
})
