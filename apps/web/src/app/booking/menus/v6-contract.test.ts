import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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
    expect(LIST).toContain('bookingApi.patchMenu(selectedAccountId, menu.id, version')
    expect(LIST).toContain('error={visibilityError ?? undefined}')
    expect(LIST).not.toContain('メニュー名で検索')
    expect(LIST).not.toContain('CSVで書き出す')
  })

  it('作成後の担当保存だけが失敗した場合は、作成済みと伝えて設定導線を出す', () => {
    expect(CREATE).toContain('setCreatedMenuNeedingStaff(res.id)')
    expect(CREATE).toContain('メニューは作成されましたが、担当スタッフを保存できませんでした。')
    expect(CREATE).toContain('担当スタッフを設定する')
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

  it('担当の取得失敗を「未登録」と誤表示しない', () => {
    expect(CREATE).toContain('staffLoadFailed')
    expect(CREATE).toContain('担当を読み込めませんでした。開き直してください')
    expect(CREATE).toContain('まだスタッフが登録されていません')
  })

  it('編集窓の入力欄は共通の枠線と輪郭へ寄せる', () => {
    expect(LIST).not.toContain('border-gray-300')
    expect(LIST).not.toContain('focus:ring-green-500')
    expect(LIST).toContain('focus:ring-accent')
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
    expect(LIST).toContain("from '../lib/format-time'")
    expect(LIST).not.toContain('function bookingWindowEnd(')
    expect(LIST).not.toContain('function businessHourSummary(')
  })

  it('営業時間の要約で存在しない末尾を断言しない', () => {
    expect(LIST).not.toContain('.at(-1)!')
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
