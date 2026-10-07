// @vitest-environment happy-dom
import { readFileSync as readRawSource } from 'node:fs'
import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChannelsTabV8 from './channels-tab-v8'

vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const ROOT = join(process.cwd(), 'src', 'app', 'booking', 'menus')
const LIST = readFileSync(join(ROOT, 'page.tsx'), 'utf8')
const CREATE = readFileSync(join(ROOT, 'new', 'page.tsx'), 'utf8')
const SETTINGS_V8 = readFileSync(join(ROOT, 'settings-v8.tsx'), 'utf8')
// タブの中身は settings-tabs/ に分かれている（見た目・動きは同じ）。
const SETTINGS_MENUS_TAB = readFileSync(join(ROOT, 'settings-tabs', 'menus-tab.tsx'), 'utf8')
const SETTINGS_CSS = readFileSync(join(ROOT, 'settings-v8.module.css'), 'utf8')

describe('V6 予約設定', () => {
  it('R91: メニューがあるときも見出しに作成の入口を常設する', () => {
    expect(LIST).toContain("tab === 'menus' && canEditMenus")
    expect(LIST).toContain('href="/booking/menus/new"')
  })

  it('設計どおり4つの設定入口と、店舗共通・メニュー別の予約ルールを持つ', () => {
    expect(LIST).toContain('受付枠')
    expect(LIST).toContain('休業日')
    expect(LIST).toContain('予約のルール')
    expect(LIST).toContain('店舗共通の予約ルール')
    expect(LIST).toContain('bookingApi.saveSettings(accountId, {')
    expect(LIST).toContain('expectedVersion: draft.version')
    expect(LIST).toContain('メニューごとの上書き')
    expect(LIST).toContain("key: 'booking_window_days'")
    expect(LIST).toContain("key: 'cutoff_hours_before'")
    expect(LIST).toContain("key: 'cancel_deadline_hours_before'")
  })

  it('作成画面で予約後の通知・リマインダ・マイルを実データから確認できる', () => {
    expect(CREATE).toContain('予約を受けたときにすること')
    expect(CREATE).toContain('予約を受け付けたことを知らせる')
    expect(CREATE).toContain('前日・開始前に思い出してもらう')
    expect(CREATE).toContain("item.eventType === 'booking_created'")
    expect(CREATE).toContain('マイルを ${formatNumber(bookingMileage)} 付ける')
  })

  it('作成画面で価格種別と店舗共通ルールの継承を実契約へ送る', () => {
    expect(CREATE).toContain('bookingApi.getSettings(selectedAccountId)')
    expect(CREATE).toContain("? 'inquiry'")
    expect(CREATE).toContain("? 'free'")
    expect(CREATE).toContain('price_mode: priceMode')
    expect(CREATE).toContain('空欄なら店舗設定を使います')
    expect(CREATE).toContain('booking_window_days: windowDays ? Number(windowDays) : null')
    expect(CREATE).toContain('cutoff_hours_before: cutoffHours ? Number(cutoffHours) : null')
    expect(CREATE).toContain('cancel_deadline_hours_before: cancelDeadlineHours')
    expect(CREATE).toContain('? Number(cancelDeadlineHours)')
  })

  it('表示している一覧操作は実際に使える', () => {
    // 分割先のコメントは画面の文言ではない。
    expect(LIST.replace(/^\s*\/\/.*$/gm, '')).not.toContain('準備中')
    expect(LIST).toContain('bookingApi.getSettings(accountId)')
    expect(LIST).toContain('<Pagination page={page} pageCount={pageCount}')
    expect(LIST).toContain("label: m.is_active ? '止める' : '再開'")
    expect(LIST).toContain('bookingApi.patchMenu(selectedAccountId, menu.id, version')
    expect(LIST).toContain('error={visibilityError ?? undefined}')
    expect(LIST).not.toContain('メニュー名で検索')
    expect(LIST).not.toContain('CSVで書き出す')
  })

  it('作成後の担当保存だけが失敗した場合は、作成済みと伝えて設定導線を出す (DEEP-16)', () => {
    // メニュー作成済みの再実行は createMenu を呼ばず、残りの担当設定だけを
    // やり直す。同名メニューの二重作成を防ぐ。
    expect(CREATE).toContain('createdMenuNeedingStaff?.menuId ?? null')
    expect(CREATE).toContain('setCreatedMenuNeedingStaff({ menuId, remainingStaffIds')
    expect(CREATE).toContain('メニューは作成済みですが、一部の担当スタッフを保存できませんでした。')
    expect(CREATE).toContain('もう一度押しても新しいメニューは増えません')
    expect(CREATE).toContain('担当の設定をやり直す')
    expect(CREATE).toContain('/booking/menus?tab=staff&menu=')
  })

  it('読込・失敗・空を同じ空状態として扱わない', () => {
    expect(LIST).toContain('<ListState kind="loading"')
    expect(LIST).toContain('<ListState kind="error"')
    expect(LIST).toContain('kind="empty"')
  })

  it('休業日タブは受付枠内の休業日へ直接飛ぶ', () => {
    expect(LIST).toContain('/booking/staff/shifts#special')
  })

  it('担当の取得失敗・取得中を「未登録」と誤表示せず作成も止める (DEEP-17)', () => {
    expect(CREATE).toContain('staffLoadState')
    expect(CREATE).toContain('担当を読み込んでいます')
    // 取得失敗は「未登録」と混ぜない。入力を残したまま、その場で取り直せる。
    expect(CREATE).toContain('担当を読み込めませんでした。入力はそのまま残っています。')
    expect(CREATE).toContain('担当をもう一度読み込む')
    expect(CREATE).toContain('reloadStaff')
    // 権限不足の失敗に再試行は出さず、権限の案内だけ出す。
    expect(CREATE).toContain('担当スタッフを見る権限がありません')
    expect(CREATE).toContain("classifyApiFailure(staffError) !== 'forbidden'")
    // 空（0人）は失敗と別の言葉で出し、登録へ誘導するのは空のときだけ。
    expect(CREATE).toContain('まだスタッフが登録されていません')
    // 候補が確定するまで保存しない。候補にいないIDは選択数に数えない。
    expect(CREATE).toContain("staffLoadState === 'loading'")
    expect(CREATE).toContain("staffLoadState === 'error'")
    expect(CREATE).toContain('担当スタッフを読み込めませんでした。下の「担当をもう一度読み込む」で読み込んでから作成してください')
    expect(CREATE).toContain('assignedIds')
  })

  it('編集窓の数値欄へ文字列が入る逃げ道を残さない', () => {
    expect(LIST).not.toContain('BookingMenu[K] | string | null')
    expect(LIST).toContain('function set<K extends keyof BookingMenu>(k: K, v: BookingMenu[K])')
  })

  it('作成は専用画面だけに寄せ、作成と編集で同じ担当必須の検証を使う', () => {
    expect(CREATE).toContain('bookingMenuError({')
    expect(LIST).toContain('bookingMenuError({')
    expect(LIST).toContain('assignedStaffCount: form.assigned_staff?.length ?? 0')
    expect(LIST).toContain('function EditMenuModal(')
    expect(LIST).not.toContain('bookingApi.createMenu(')
    expect(LIST).not.toContain("'新規メニュー'")
  })

  it('日時の表示は予約設定内の共通整形を使う', () => {
    // readUiSource は共通整形の定義まで読むので、入口だけを検査する。
    const entry = readRawSource(join(ROOT, 'page.tsx'), 'utf8')
    expect(entry).toContain("from '../lib/format-time'")
    expect(entry).not.toContain('function bookingWindowEnd(')
    expect(entry).not.toContain('function businessHourSummary(')
  })

  it('営業時間の要約で存在しない末尾を断言しない', () => {
    expect(LIST).not.toContain('.at(-1)!')
  })

  it('C9fv7A: 閲覧のみは帯と押せない作るボタンと目印を出す', () => {
    // 閲覧のみの帯と押せない作るボタンはメニュータブの中にある。
    expect(SETTINGS_MENUS_TAB).toContain('閲覧のみで見ています。変える操作は管理者に頼んでください。')
    expect(SETTINGS_MENUS_TAB).toContain('<Button variant="primary" disabled')
    expect(SETTINGS_V8).toContain("tab === 'menus' && !canEditMenus ? 'C9fv7A'")
  })

  it('P6EdLW: 1152ではメニュー表の担当・30日を畳む', () => {
    expect(SETTINGS_CSS).toContain('@container (max-width: 1080px)')
    expect(SETTINGS_CSS).toMatch(/\.colStaff,\s*\.colCount\s*\{\s*display:\s*none/)
  })

  it('VFxWU: 1152の右欄は見え方ボタンと確かめるボタンの2つ', () => {
    expect(SETTINGS_V8).toContain('LINEでの見え方を見る')
    expect(SETTINGS_V8).toContain('setPhoneOpen(true)')
    expect(SETTINGS_V8).toContain('お客さまに見える画面を確かめる')
    expect(SETTINGS_CSS).toMatch(/\.sidePhoneButton\s*\{[^}]*display:\s*flex/)
  })

  it('ZyDd6: 予約経路タブは経路の口から表を作る', () => {
    expect(SETTINGS_V8).toContain("{ key: 'channels', label: '予約経路', node: 'ZyDd6' }")
    expect(SETTINGS_V8).toContain('/api/booking/admin/channels?account_id=')
    expect(SETTINGS_V8).toContain('スタッフの Google カレンダー')
    expect(SETTINGS_V8).toContain('data-design-node="wJYQb"')
  })

  it('wJYQb: 指名なしの自動割り当てだけを保存できる決まりにする', () => {
    expect(SETTINGS_V8).toContain('/api/booking/admin/channels/settings?account_id=')
    expect(SETTINGS_V8).toContain('指名なしの予約は、その時間に空いているスタッフへ自動で割り当て')
  })
})

describe('wJYQb 自動割り当ての保存・権限・失敗', () => {
  function installChannels(saveStatus = 200) {
    const requests: Array<{ accountId: string | null; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json' },
      })
      if (url.pathname === '/api/booking/admin/channels/settings') {
        requests.push({ accountId: url.searchParams.get('account_id'), body: JSON.parse(String(init?.body)) })
        expect(init?.method).toBe('PUT')
        return saveStatus === 200 ? json({ ok: true }) : json({ error: 'test failure' }, saveStatus)
      }
      if (url.pathname === '/api/booking/admin/channels') {
        return json({ success: true, data: { timeZone: 'Asia/Tokyo', staff: [], channels: [], autoAssign: true } })
      }
      if (url.pathname === '/api/booking/admin/conflicts') return json({ success: true, data: { conflicts: [] } })
      throw new Error(`Unexpected API: ${url.pathname}`)
    }))
    return requests
  }

  it('取得済みの設定を表示し、選んだアカウントへ変更を保存する', async () => {
    const requests = installChannels()
    render(React.createElement(ChannelsTabV8, { accountId: 'account-a', canEdit: true }))
    const toggle = await screen.findByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await act(async () => { toggle.click() })
    expect(requests).toEqual([{ accountId: 'account-a', body: { autoAssign: false } }])
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('閲覧のみでは保存を送らず、現在の設定は読める', async () => {
    const requests = installChannels()
    render(React.createElement(ChannelsTabV8, { accountId: 'account-a', canEdit: false }))
    const toggle = await screen.findByRole('switch')
    expect(toggle.closest('fieldset')?.disabled).toBe(true)
    await act(async () => { toggle.click() })
    expect(requests).toEqual([])
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('保存に失敗したら設定を変えず、失敗を知らせて再操作を許す', async () => {
    const requests = installChannels(503)
    render(React.createElement(ChannelsTabV8, { accountId: 'account-a', canEdit: true }))
    const toggle = await screen.findByRole('switch')
    await act(async () => { toggle.click() })
    expect(requests).toHaveLength(1)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(toggle.closest('fieldset')?.disabled).toBe(false)
  })
})

describe('画面確認の固定メニューは本番と同じ器を持つ', () => {
  it('一覧の全件が価格種別・版・実効ルールを持つ', async () => {
    const fixturesPath = join(process.cwd(), '..', '..', 'scripts', 'visual-qa', 'fixtures.mjs')
    const fixtures = (await import(pathToFileURL(fixturesPath).href)) as {
      BOOKING_MENUS: Array<Record<string, unknown>>
      BOOKING_SETTINGS: { menuCount: number }
    }
    expect(fixtures.BOOKING_MENUS).toHaveLength(fixtures.BOOKING_SETTINGS.menuCount)
    for (const menu of fixtures.BOOKING_MENUS) {
      expect(['fixed', 'free', 'inquiry']).toContain(menu.price_mode)
      expect(menu.price_mode === 'free' ? menu.base_price === 0 : menu.base_price !== 0).toBe(true)
      expect(Number.isInteger(menu.version) && (menu.version as number) >= 1).toBe(true)
      expect(Array.isArray(menu.assigned_staff)).toBe(true)
      expect(typeof menu.booking_count_30_days).toBe('number')
      const rules = menu.effectiveBookingRules as Record<string, unknown>
      const source = rules.source as Record<string, unknown>
      for (const key of ['bookingWindowDays', 'cutoffMinutesBefore', 'cancelDeadlineMinutesBefore']) {
        expect(typeof rules[key]).toBe('number')
        expect(['store', 'menu']).toContain(source[key])
      }
    }
  })
})
