// @vitest-environment happy-dom
/*
 * 分析レポート作成の V8（板 H5UoIu）と作成時の競合小窓（G83vi）。
 *
 * V8 の頭・帯・右欄と、保存・競合時の入力保護を確認する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

const fixture = vi.hoisted(() => ({
  editId: null as string | null,
  accountId: 'account-a',
  pushes: [] as string[],
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { fixture.pushes.push(href) } }),
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? fixture.editId : null) }),
  usePathname: () => '/analytics/reports/new',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageChrome: () => ({ title: null, fullWidth: false }),
}))

const SCHEDULE = {
  id: 'report-1', lineAccountId: 'account-a', name: '週次まとめ',
  sections: ['friends', 'reactions'], savedAnalysisIds: [],
  cadence: 'weekly', weekday: 1, monthDay: null,
  sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
  recipients: [{ kind: 'staff', staffId: 'u-1', label: '担当1' }],
  channels: ['dashboard', 'email'], alertRules: [],
  status: 'active', isOneTime: false,
  nextRunAt: '2026-09-28T00:00:00.000Z', createdBy: 'u-1',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

const OPTIONS = {
  timeZone: 'Asia/Tokyo',
  savedAnalyses: [],
  recipients: [{ id: 'u-1', name: '担当1', role: 'owner', email: 'u1@example.com', lineLinked: true }],
}

const net = vi.hoisted(() => ({
  puts: [] as unknown[],
  putMode: 'ok' as 'ok' | 'conflict-then-ok' | 'deferred' | 'failure',
  deferred: [] as Array<(value: Response) => void>,
  gets: 0,
  getMode: 'normal' as 'normal' | 'deferred' | 'failure',
  getDeferred: [] as Array<(value: Response) => void>,
  latestVersion: '2026-09-01T00:00:00.000Z',
  latestName: null as string | null,
  role: 'owner' as 'owner' | 'staff',
}))

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
    const raw = typeof input === 'string' ? input : String(input)
    const url = new URL(raw.startsWith('http') ? raw : `https://worker.example.com${raw}`)
    if (url.pathname === '/api/staff/me') {
      return new Response(JSON.stringify({ success: true, data: { role: net.role } }), { status: 200 })
    }
    if (url.pathname.startsWith('/api/analytics/report-schedules/report-1') && (init?.method ?? 'GET') === 'PUT') {
      if (net.putMode === 'failure') {
        return new Response(JSON.stringify({ success: false, error: 'internal failure' }), { status: 500 })
      }
      if (net.putMode === 'conflict-then-ok') {
        net.putMode = 'ok'
        return new Response(
          JSON.stringify({ success: false, error: 'この定期レポートは別の画面で先に更新されました。最新の内容を読み込み直してください' }),
          { status: 409 },
        )
      }
      if (net.putMode === 'deferred') {
        return new Promise<Response>((resolve) => { net.deferred.push(resolve) })
      }
      net.puts.push(1)
      return new Response(JSON.stringify({ success: true, data: { ...SCHEDULE, updatedAt: '2026-09-03T00:00:00.000Z' } }), { status: 200 })
    }
    if (url.pathname.startsWith('/api/analytics/report-schedules')) {
      // 初回の読み込みは保存済みの名前、取り直しはほかの人が変えた名前。
      net.gets += 1
      if (net.getMode === 'failure') return new Response(JSON.stringify({ success: false, error: '取得できませんでした' }), { status: 500 })
      if (net.getMode === 'deferred') return new Promise<Response>((resolve) => { net.getDeferred.push(resolve) })
      const name = net.latestName ?? (net.gets === 1 ? SCHEDULE.name : 'ほかの人が変えた名前')
      return new Response(JSON.stringify({
        success: true,
        data: { items: [{ ...SCHEDULE, name, updatedAt: net.latestVersion }], options: OPTIONS },
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: false, error: '未設定' }), { status: 500 })
  })
}

import AnalyticsReportNewPage from './page'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

let container: HTMLDivElement
let root: Root

async function mount() {
  clearToastsForTest()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<><AnalyticsReportNewPage /><ToastHost /></>) })
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {})
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === text,
  )
  if (!found) throw new Error(`「${text}」のボタンが見つかりません`)
  return found as HTMLButtonElement
}

/* 比べる窓は document.body 直下の覆いに出る（container の外）。 */
function overlayButtonByText(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === text && !container.contains(b),
  )
  if (!found) throw new Error(`覆いの「${text}」のボタンが見つかりません`)
  return found as HTMLButtonElement
}

function overlayText(): string {
  return document.body.textContent ?? ''
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.documentElement.dataset.theme = 'v8'
  fixture.editId = null
  fixture.accountId = 'account-a'
  fixture.pushes.length = 0
  net.puts.length = 0
  net.putMode = 'ok'
  net.deferred.length = 0
  net.gets = 0
  net.getMode = 'normal'
  net.getDeferred.length = 0
  net.latestVersion = SCHEDULE.updatedAt
  net.latestName = null
  installFetch()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

describe('V8 レポート作成（H5UoIu）', () => {
  it('板ID・題・必須・右欄の見本を出す', async () => {
    await mount()
    await settle()
    const framed = container.querySelector('[data-design-node="H5UoIu"]')
    expect(framed).toBeTruthy()
    expect(container.textContent).toContain('レポートを作る')
    expect(container.textContent).toContain('見たい数をまとめて')
    // 配信先・頻度は必須
    expect(container.textContent).toContain('必須')
    // 右欄の見本（作り物の数値は入れない）
    expect(container.textContent).toContain('こう届きます')
    expect(container.textContent).toContain('レポートが見ているもの')
    expect(container.textContent).toContain('数は送る時刻の時点で集めます')
    expect(container.textContent).toContain('宛先がブロックしていると、LINE では届きません')
  })

  it('閲覧のみ：作る・送る・宛先を足す・選ぶ・札の × を置かない（帯は出す）', async () => {
    net.role = 'staff'
    try {
      await mount()
      await settle()
      const text = container.textContent ?? ''
      expect(text).toContain('運用担当は内容を確認できます')
      for (const label of ['つくって動かす', '今すぐ1回だけ送る', '＋ 宛先を足す', '＋ 保存した分析を選ぶ']) {
        expect([...container.querySelectorAll('button, a')].some((item) => item.textContent?.trim() === label)).toBe(false)
      }
      expect(container.querySelector('.report-v8-chipRemove')).toBeNull()
      expect([...container.querySelectorAll('button, a')].some((item) => item.textContent?.trim() === 'キャンセル')).toBe(true)
    } finally {
      net.role = 'owner'
    }
  })

  it('名前が空のまま押すと欄の下に文が出る', async () => {
    await mount()
    await settle()
    const nameField = container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement | null
    if (!nameField) throw new Error('名前の入力が見つかりません')
    await act(async () => { fireEvent.change(nameField, { target: { value: '' } }) })
    // 宛先を選んで保存できる形にする
    const person = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (item) => !(item as HTMLInputElement).disabled && item.closest('label')?.textContent?.includes('担当1'),
    ) as HTMLInputElement | undefined
    if (!person) throw new Error('宛先が見つかりません')
    await act(async () => { fireEvent.click(person) })
    await click(buttonByText('つくって動かす'))
    await settle()
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(nameField.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(nameField)
    expect(container.textContent).toContain('レポートの名前を入力してください')
  })

  it('知らせる条件の空欄は0として保存せず、その欄へ移る', async () => {
    fixture.editId = 'report-1'
    await mount()
    await settle()
    const toggle = [...container.querySelectorAll('input[type="checkbox"]')].find((item) => item.closest('label')?.textContent?.includes('大きな変化を知らせる')) as HTMLInputElement
    await act(async () => { fireEvent.click(toggle) })
    const condition = container.querySelector('input[aria-label="友だち減少の条件を使う"]') as HTMLInputElement
    await act(async () => { fireEvent.click(condition) })
    const threshold = container.querySelector('#report-alert-friend_adds-threshold') as HTMLInputElement
    await act(async () => { fireEvent.change(threshold, { target: { value: '' } }) })
    await click(buttonByText('変更を保存する'))
    await settle()
    expect(document.activeElement).toBe(threshold)
    expect(threshold.getAttribute('aria-invalid')).toBe('true')
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(net.puts).toHaveLength(0)
  })
})

describe('V8 作成時の競合小窓（G83vi）', () => {
  it('通常の保存成功で離脱確認を解除し、次の編集では再び入力を守る', async () => {
    fixture.editId = 'report-1'
    await mount()
    await settle()
    const nameField = container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement
    await act(async () => { fireEvent.change(nameField, { target: { value: '保存する名前' } }) })
    const beforeSave = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeSave)
    expect(beforeSave.defaultPrevented).toBe(true)

    await click(buttonByText('変更を保存する'))
    await settle()
    expect(net.puts).toHaveLength(1)
    const afterSave = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterSave)
    expect(afterSave.defaultPrevented).toBe(false)
    expect(nameField.value).toBe('保存する名前')

    await act(async () => { fireEvent.change(nameField, { target: { value: '次の編集' } }) })
    const afterEdit = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterEdit)
    expect(afterEdit.defaultPrevented).toBe(true)
  })

  it('保存が失敗したら未保存の扱いと入力を残す', async () => {
    fixture.editId = 'report-1'
    net.putMode = 'failure'
    await mount()
    await settle()
    const nameField = container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement
    await act(async () => { fireEvent.change(nameField, { target: { value: '残す名前' } }) })
    await click(buttonByText('変更を保存する'))
    await settle()
    expect(container.textContent).toContain('保存できませんでした')
    expect(container.textContent).not.toContain('API error:')
    expect(container.textContent).not.toContain('internal failure')
    expect(nameField.value).toBe('残す名前')
    const afterFailure = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterFailure)
    expect(afterFailure.defaultPrevented).toBe(true)

    net.putMode = 'ok'
    await click(buttonByText('変更を保存する'))
    await settle()
    expect(net.puts).toHaveLength(1)
    expect(container.textContent).not.toContain('保存できませんでした')
    const afterRetry = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterRetry)
    expect(afterRetry.defaultPrevented).toBe(false)
  })

  it('比較後の保存が失敗しても窓と入力を残し、同じ内容で再試行できる', async () => {
    fixture.editId = 'report-1'
    net.putMode = 'conflict-then-ok'
    await mount()
    await settle()
    const nameField = container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement
    await act(async () => { fireEvent.change(nameField, { target: { value: '比較して残す名前' } }) })
    await click(buttonByText('変更を保存する'))
    await settle()
    await click(buttonByText('違いを比べる'))

    net.putMode = 'failure'
    await click(overlayButtonByText('この内容で保存する'))
    await settle()
    expect(overlayText()).toContain('保存できませんでした')
    expect(overlayText()).not.toContain('API error:')
    expect(overlayText()).not.toContain('internal failure')
    expect(nameField.value).toBe('比較して残す名前')
    expect(container.querySelector('[data-design-node="G83vi"]')).toBeTruthy()
    expect(overlayButtonByText('この内容で保存する').disabled).toBe(false)
    const afterFailure = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterFailure)
    expect(afterFailure.defaultPrevented).toBe(true)

    net.putMode = 'ok'
    await click(overlayButtonByText('この内容で保存する'))
    await settle()
    expect(net.puts).toHaveLength(1)
    expect(container.querySelector('[data-design-node="G83vi"]')).toBeNull()
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(nameField.value).toBe('比較して残す名前')
    const afterRetry = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterRetry)
    expect(afterRetry.defaultPrevented).toBe(false)
  })

  it('409で帯が出て入力が残り、比べたうえで保存できる', async () => {
    fixture.editId = 'report-1'
    net.putMode = 'conflict-then-ok'
    await mount()
    await settle()
    expect(buttonByText('変更を保存する')).toBeTruthy()

    // 入力中の名前を変えてから保存する（取り直した最新と食い違う）。
    const nameField = container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement | null
    if (!nameField) throw new Error('名前の入力が見つかりません')
    await act(async () => { fireEvent.change(nameField, { target: { value: 'わたしの入力' } }) })

    await click(buttonByText('変更を保存する'))
    await settle()

    // 板が競合になり、帯が出る。入力は残る（最新の名前で上書きしない）。
    expect(container.querySelector('[data-design-node="G83vi"]')).toBeTruthy()
    expect(container.textContent).toMatch(/ほかの人が.*このレポートを.*保存しました/)
    expect(container.textContent).toContain('このまま保存すると、相手の変更が消えます。入力は残っています。')
    expect((container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement).value).toBe('わたしの入力')
    // 下の帯の主ボタンは比べる向きになる
    expect(buttonByText('比べてから保存')).toBeTruthy()

    // 比べる窓を開く。最新の文と入力の文が並ぶ。
    await click(buttonByText('違いを比べる'))
    await settle()
    expect(overlayText()).toContain('違いを比べる')
    expect(overlayText()).toContain('名前: ほかの人が変えた名前')
    expect(overlayText()).toContain('名前: わたしの入力')

    // 比べたうえで保存する。最新の版つきでもう一度送る。
    await click(overlayButtonByText('この内容で保存する'))
    await settle()
    expect(net.puts).toHaveLength(1)
    expect(container.querySelector('[data-design-node="G83vi"]')).toBeNull()
    expect(container.textContent).toContain('定期レポートを更新しました')
  })

  it('最新を読み込んで続けると最新の内容に戻る', async () => {
    fixture.editId = 'report-1'
    net.putMode = 'conflict-then-ok'
    await mount()
    await settle()
    await click(buttonByText('変更を保存する'))
    await settle()
    expect(container.querySelector('[data-design-node="G83vi"]')).toBeTruthy()

    await click(buttonByText('最新を読み込んで続ける'))
    await settle()
    expect(container.querySelector('[data-design-node="H5UoIu"]')).toBeTruthy()
    expect((container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement).value).toBe('ほかの人が変えた名前')
    expect(buttonByText('変更を保存する')).toBeTruthy()
  })

  it('比較を開いた後にさらに更新されていたら、未確認の内容を上書きしない', async () => {
    fixture.editId = 'report-1'
    net.putMode = 'conflict-then-ok'
    await mount()
    await settle()
    await click(buttonByText('変更を保存する'))
    await settle()
    await click(buttonByText('違いを比べる'))
    net.latestVersion = '2026-09-05T00:00:00.000Z'
    net.latestName = 'さらに新しい変更'
    await click(overlayButtonByText('この内容で保存する'))
    await settle()
    expect(net.puts).toHaveLength(0)
    expect(overlayText()).toContain('内容がさらに変更されました')
    expect(overlayText()).toContain('名前: さらに新しい変更')
    await click(overlayButtonByText('この内容で保存する'))
    await settle()
    expect(net.puts).toHaveLength(1)
  })

  it('最新の読み込みはその場で取り直し、失敗しても入力を消さない', async () => {
    fixture.editId = 'report-1'
    net.putMode = 'conflict-then-ok'
    await mount()
    await settle()
    const nameField = container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement
    await act(async () => { fireEvent.change(nameField, { target: { value: '残したい入力' } }) })
    await click(buttonByText('変更を保存する'))
    await settle()
    const reads = net.gets
    net.getMode = 'failure'
    await click(buttonByText('最新を読み込んで続ける'))
    await settle()
    expect(net.gets).toBe(reads + 1)
    expect(nameField.value).toBe('残したい入力')
    expect(container.textContent).toContain('最新の内容を読み込めませんでした。入力は残っています')
    net.getMode = 'normal'
    net.latestName = 'ボタンを押した時点の最新'
    net.latestVersion = '2026-09-06T00:00:00.000Z'
    await click(buttonByText('最新を読み込んで続ける'))
    await settle()
    expect(nameField.value).toBe('ボタンを押した時点の最新')
  })

  it('比較用の取得中にアカウントを往復しても、遅い結果で保存を始めない', async () => {
    fixture.editId = 'report-1'
    net.putMode = 'conflict-then-ok'
    await mount()
    await settle()
    await click(buttonByText('変更を保存する'))
    await settle()
    await click(buttonByText('違いを比べる'))
    net.getMode = 'deferred'
    await click(overlayButtonByText('この内容で保存する'))
    await settle()
    expect(net.getDeferred).toHaveLength(1)
    net.getMode = 'normal'
    for (const accountId of ['account-b', 'account-a']) {
      fixture.accountId = accountId
      await act(async () => { root.render(<><AnalyticsReportNewPage /><ToastHost /></>) })
      await settle()
    }
    const nameField = container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement
    await act(async () => { fireEvent.change(nameField, { target: { value: '新しい入力' } }) })
    await act(async () => { net.getDeferred.splice(0).forEach((resolve) => resolve(new Response(JSON.stringify({ success: true, data: { items: [SCHEDULE], options: OPTIONS } }), { status: 200 }))) })
    await settle()
    expect(net.puts).toHaveLength(0)
    expect(nameField.value).toBe('新しい入力')
    expect(container.textContent).not.toContain('定期レポートを更新しました')
  })

  it('保存中は押せない（二重押し防止）', async () => {
    fixture.editId = 'report-1'
    net.putMode = 'deferred'
    await mount()
    await settle()
    await click(buttonByText('変更を保存する'))
    await settle()
    // 応答が戻るまで保存ボタンは押せない。戻れば通る。
    expect(net.deferred).toHaveLength(1)
    expect(buttonByText('保存しています').disabled).toBe(true)
    await act(async () => {
      net.deferred.splice(0).forEach((resolve) => resolve(
        new Response(JSON.stringify({ success: true, data: { ...SCHEDULE, updatedAt: '2026-09-03T00:00:00.000Z' } }), { status: 200 }),
      ))
    })
    await settle()
    expect(container.textContent).toContain('定期レポートを更新しました')
  })
})
