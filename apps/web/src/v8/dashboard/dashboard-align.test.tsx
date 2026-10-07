// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DashboardColumns, DashboardRow } from '@/components/templates/dashboard-page'
import DashboardEditor from '@/components/dashboard/dashboard-editor'
import {
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
  V8_DASHBOARD_DEFAULT_VISIBILITY,
} from '@/components/dashboard/dashboard-preference-defaults'
import { partialFailureLabels, partialFailuresWithoutCard } from '@/components/dashboard/partial-failure-labels'
import { ConnectionStatus, SupportStatus, webhookState } from './sections'

/*
 * ★V8 ダッシュボード（d8X09・WQmep）：右の列は上の数の帯の1マス分。
 * 縦の線を帯の線と一直線にするため、段は帯と同じ等分の格子に載る。
 * 実際の座標（1440〜1152・左メニュー開閉で ±0px）は撮影で確かめた。ここは仕組みを見張る。
 */
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

const css = readFileSync(join(__dirname, '../../components/templates/page-templates.module.css'), 'utf8')

describe('右の列を帯の1マス分にする口', () => {
  it("asideSize='column' は段に印と帯のマスの数を渡す", () => {
    const { container } = render(<DashboardRow asideSize="column" asideColumns={3} aside={<p>右</p>}>左</DashboardRow>)
    const row = container.firstElementChild as HTMLElement
    expect(row.dataset.asideSize).toBe('column')
    expect(row.style.getPropertyValue('--tpl-dash-cols')).toBe('3')
  })

  it('右の列が無い段には印を付けない（左が全幅のまま）', () => {
    const { container } = render(<DashboardRow asideSize="column">左</DashboardRow>)
    expect((container.firstElementChild as HTMLElement).dataset.asideSize).toBeUndefined()
  })

  it('段は帯と同じ等分の格子。左は最後の1列の手前まで、右は最後の1列', () => {
    expect(css).toMatch(/\.dashboardRow\[data-aside-size='column'\] \{ display: grid; grid-template-columns: repeat\(var\(--tpl-dash-cols\), minmax\(0, 1fr\)\); \}/)
    expect(css).toMatch(/\[data-aside-size='column'\] > \.dashboardCell \{ grid-column: 1 \/ -2; \}/)
    expect(css).toMatch(/\[data-aside-size='column'\] > \.dashboardAside \{ grid-column: -2 \/ -1; width: auto; \}/)
    // 横並びの段も等分の格子（flex の配分だと線の太さ分ずれる）。高さの下限は置かない（中身の下に空きを作らない）。
    expect(css).toMatch(/\.dashboardColumns \{ display: grid; grid-auto-flow: column; grid-auto-columns: minmax\(0, 1fr\); \}/)
    expect(css).not.toMatch(/\.dashboardColumns \{ min-height/)
  })

  it('狭い板（1100 未満）でも 1マス分の右の列は隠さない', () => {
    const narrow = css.slice(css.indexOf('@container v8-page (max-width: 1099px)'))
    expect(narrow).toContain(".dashboardAside:not([data-aside-size='column']) { display: none; }")
  })

  it('横並びの段は子の数だけ並ぶ', () => {
    const { container } = render(<DashboardColumns>{[<p key="a">a</p>, <p key="b">b</p>]}</DashboardColumns>)
    expect(container.firstElementChild?.children).toHaveLength(2)
  })
})

describe('V8 の既定の表示', () => {
  it('友だちの状態は V8 では既定で表示（友だち追加リンクの右）。v7 の既定は変えない', () => {
    const v8 = defaultDashboardPreferences(V8_DASHBOARD_DEFAULT_VISIBILITY)
    expect(v8.right.find((item) => item.id === 'friend-status')?.visible).toBe(true)
    expect(defaultDashboardPreferences().right.find((item) => item.id === 'friend-status')?.visible).toBe(false)
    // 保存済みで隠した人の選択は上書きしない
    const saved = normalizeDashboardPreferences({ right: [{ id: 'friend-status', visible: false }] }, V8_DASHBOARD_DEFAULT_VISIBILITY)
    expect(saved.right.find((item) => item.id === 'friend-status')?.visible).toBe(false)
    // 保存に無いカードは V8 の既定で補う
    const missing = normalizeDashboardPreferences({ right: [] }, V8_DASHBOARD_DEFAULT_VISIBILITY)
    expect(missing.right.find((item) => item.id === 'friend-status')?.visible).toBe(true)
  })
})

describe('読めなかった項目は日本語の名前', () => {
  it('内部の名前（quota など）を出さない', () => {
    expect(partialFailureLabels(['quota'])).toBe('送信枠')
    expect(partialFailureLabels(['quota', 'friends', 'quota'])).toBe('送信枠、友だちの状態')
    expect(partialFailureLabels(['unknown-x'])).toBe('その他')
  })

  it('部品の中で自分のエラーを出すカードが見えていれば、頭の帯には重ねない', () => {
    expect(partialFailuresWithoutCard(['quota'], new Set(['send-quota']))).toEqual([])
    expect(partialFailuresWithoutCard(['quota'], new Set())).toEqual(['quota'])
    expect(partialFailuresWithoutCard(['quota', 'broadcasts'], new Set(['send-quota']))).toEqual(['broadcasts'])
  })
})

describe('右の列：現在の対応状況と接続状態', () => {
  it('対応状況の4行は状態の色の丸を前に置く（未対応 赤・対応中 橙・保留 灰・対応済み 緑）', () => {
    const { container } = render(<SupportStatus inbox={{ unanswered: 5, inProgress: 0, onHold: 0, resolved: 38 } as never} autoOnInbound />)
    const dots = [...container.querySelectorAll('a > span[aria-hidden="true"]')].map((dot) => dot.className)
    expect(dots).toHaveLength(4)
    expect(dots[0]).toMatch(/dot_danger/)
    expect(dots[1]).toMatch(/dot_warning/)
    expect(dots[2]).not.toMatch(/dot_(danger|warning|success)/)
    expect(dots[3]).toMatch(/dot_success/)
  })

  it('Webhook の値は 正常／要確認（理由つき）／未確認。「確認中」で止まらない', () => {
    expect(webhookState({ connection: { status: 'ok', checkedAt: 'x' } } as never).label).toBe('正常')
    expect(webhookState({ webhook: { status: 'matched' } } as never).label).toBe('正常')
    expect(webhookState({ connection: { status: 'unknown', checkedAt: null } } as never).label).toBe('未確認')
    expect(webhookState(null).label).toBe('未確認')
    const warn = webhookState({ connection: { status: 'warn', checkedAt: 'x', issues: [{ kind: 'webhook_endpoint', result: 'unconfigured', expectedUrl: null, registeredUrl: null, webhookActive: null, httpStatus: null }] } } as never)
    expect(warn.label).toBe('要確認')
    expect(warn.reason?.text).toBe('LINE に Webhook の URL が登録されていません')
  })

  it('要確認・未確認は「確かめる」（権限のある人だけ）。押している間だけ「確認中」', async () => {
    const account = { id: 'a1', revision: 3, connection: { status: 'unknown', checkedAt: null } } as never
    let finish: () => void = () => {}
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = () => resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })) }))
    vi.stubGlobal('fetch', fetchMock)
    const onChecked = vi.fn()
    const { rerender } = render(<ConnectionStatus account={account} canCheck={false} onChecked={onChecked} risk="normal" activeFriends={1} />)
    expect(screen.queryByRole('button', { name: 'LINE Webhook の接続を確かめる' })).toBeNull()
    expect(screen.getByText('未確認')).toBeTruthy()
    rerender(<ConnectionStatus account={account} canCheck onChecked={onChecked} risk="normal" activeFriends={1} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'LINE Webhook の接続を確かめる' })) })
    expect(screen.getByText('確認中')).toBeTruthy()
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/api/line-accounts/a1/connection-checks')
    await act(async () => { finish() })
    expect(onChecked).toHaveBeenCalled()
    expect(screen.queryByText('確認中')).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('ダッシュボード編集の表示の切り替え', () => {
  const props = () => ({
    open: true,
    preferences: defaultDashboardPreferences(V8_DASHBOARD_DEFAULT_VISIBILITY),
    onCancel: vi.fn(),
    onApply: vi.fn(),
  })

  it('V8 はスイッチ（読み上げ「〇〇を表示」）。押すとオン・オフが変わる', async () => {
    document.documentElement.dataset.theme = 'v8'
    await act(async () => { render(<DashboardEditor {...props()} />) })
    const toggle = screen.getByRole('switch', { name: '写真審査を表示' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.getByRole('switch', { name: '写真審査を表示' }).getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeNull()
  })

  it('V8 でも「今日やること」の切り替えは同じ動き（オフ→オンで4枠に戻る）', async () => {
    document.documentElement.dataset.theme = 'v8'
    await act(async () => { render(<DashboardEditor {...props()} />) })
    fireEvent.click(screen.getByRole('switch', { name: '写真審査を表示' }))
    fireEvent.click(screen.getByRole('switch', { name: '写真審査を表示' }))
    const on = ['対応が必要な受信', '写真審査', '今日の予約', '出荷予定件数']
      .map((label) => screen.getByRole('switch', { name: `${label}を表示` }).getAttribute('aria-checked'))
    expect(on.filter((value) => value === 'true')).toHaveLength(4)
  })

  it('v7 はチェックの箱のまま', async () => {
    await act(async () => { render(<DashboardEditor {...props()} />) })
    expect(screen.queryByRole('switch', { name: '写真審査を表示' })).toBeNull()
    expect(document.querySelector('input[aria-label="写真審査を非表示にする"]')).not.toBeNull()
  })
})
