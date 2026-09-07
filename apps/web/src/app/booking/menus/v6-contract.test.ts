import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src', 'app', 'booking', 'menus')
const LIST = readFileSync(join(ROOT, 'page.tsx'), 'utf8')
const CREATE = readFileSync(join(ROOT, 'new', 'page.tsx'), 'utf8')

describe('V6 予約設定', () => {
  it('V6の一覧・状態・作成画面を実ノードへ結び付ける', () => {
    expect(LIST).toContain('data-design-node="QSLEH"')
    expect(LIST).toContain('data-design-node="W6465r"')
    expect(CREATE).toContain('designNode="GhOb3"')
  })

  it('本文に画面タイトルを重ねず、行き先が分かる操作名にする', () => {
    expect(LIST).not.toContain('<Header')
    expect(CREATE).toContain('showHeader={false}')
    expect(LIST).toContain('予約メニューを作る')
    expect(LIST).toContain('受付枠')
    expect(LIST).toContain('休業日')
  })

  it('設計どおり4つの設定入口と、散らばっていた予約ルールの一覧を持つ', () => {
    expect(LIST).toContain('受付枠')
    expect(LIST).toContain('休業日')
    expect(LIST).toContain('予約のルール')
    expect(LIST).toContain('予約のルールをまとめて確認')
    expect(LIST).toContain("key: 'booking_window_days'")
    expect(LIST).toContain("key: 'cutoff_hours_before'")
    expect(LIST).toContain("key: 'cancel_deadline_hours_before'")
  })

  it('作成画面で予約後の通知・リマインダ・マイルを実データから確認できる', () => {
    expect(CREATE).toContain('予約を受けたときにすること')
    expect(CREATE).toContain('予約を受け付けたことを知らせる')
    expect(CREATE).toContain('前日・開始前に思い出してもらう')
    expect(CREATE).toContain("item.eventType === 'booking_created'")
    expect(CREATE).toContain('マイルを ${bookingMileage.toLocaleString()} 付ける')
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
    expect(LIST).not.toContain('準備中')
    expect(LIST).toContain('bookingApi.getSettings(selectedAccountId)')
    expect(LIST).toContain('<Pagination page={page} pageCount={pageCount}')
    expect(LIST).toContain('止める・出す')
    expect(LIST).not.toContain('メニュー名で検索')
    expect(LIST).not.toContain('CSVで書き出す')
  })

  it('読込・失敗・空を同じ空状態として扱わない', () => {
    expect(LIST).toContain('<ListState kind="loading"')
    expect(LIST).toContain('<ListState kind="error"')
    expect(LIST).toContain('kind="empty"')
  })
})
