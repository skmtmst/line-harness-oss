import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LIST = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('予約URLの未設定案内', () => {
  it('API接続先の欠落とLIFF未設定で文言を分ける(点検#516軽4)', () => {
    // どちらもURLが作れないが、直す人が違う(管理者/アカウント設定)。混ぜると切り分けを誤る。
    expect(LIST).toContain('APIの接続先が設定されていません')
    expect(LIST).toContain('このアカウントには LIFF ID が未設定です')
    expect(LIST).toContain('!workerBase')
  })
})

describe('予約履歴URLの発行 (#933 N-396)', () => {
  it('LIFF履歴画面へ view=history で渡すURLを発行・コピーできる', () => {
    // 「予約履歴URLは準備中です」は #933 で解消。残っていたら所見が戻っている。
    expect(LIST).not.toContain('予約履歴URLは準備中です')
    expect(LIST).toContain('page=salon-book&view=history')
    expect(LIST).toContain('aria-label="予約履歴URL"')
    expect(LIST).toContain('copyUrl(historyUrl)')
  })
})

describe('台帳CSVと絞り込み (#933 N-397/N-398)', () => {
  it('完了・来店なしのタブがある', () => {
    expect(LIST).toContain("{ key: 'completed', label: '完了' }")
    expect(LIST).toContain("{ key: 'no_show', label: '来店なし' }")
  })

  it('担当者・予約経路の絞り込みが一覧の取得とCSVの両方に渡る', () => {
    expect(LIST).toContain('aria-label="担当者で絞り込む"')
    expect(LIST).toContain('aria-label="予約経路で絞り込む"')
    // 同じ条件を一覧取得とCSV URLの両方へ渡す（片方だけだと件数と書出しがずれる）
    expect(LIST).toContain('staffId: staffFilter')
    expect(LIST).toContain('source: sourceFilter')
    expect(LIST).toContain('bookingApi.ledgerCsvUrl')
    expect(LIST).toContain('CSVで書き出す')
  })
})

describe('閲覧のみの人への表示 (#933 N-401)', () => {
  it('操作ボタンは canOperate で隠す（権限が読めるまで出さない）', () => {
    expect(LIST).toContain('const [canOperate, setCanOperate] = useState(false)')
    expect(LIST).toContain('canOperateBookings(response.data)')
    // 代理予約の入口・行の操作・詳細パネルの操作がすべて canOperate で守られる
    expect(LIST).toContain('{canOperate ? (')
    expect(LIST).toContain('<BookingCalendar')
    expect(LIST).toContain('canCreate={canOperate}')
  })
})
