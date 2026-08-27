import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')
const LIST = read('page.tsx')
const CREATE = read('new', 'page.tsx')
const BOOKINGS = read('bookings', 'page.tsx')
const EDIT = read('edit', 'page.tsx')
const ALL = LIST + CREATE + BOOKINGS + EDIT

describe('V6イベント予約の画面契約', () => {
  it('V6正本の4画面を実ノードIDへ結び付ける', () => {
    expect(LIST).toContain('data-design-node="ugP5y"')
    expect(LIST).toContain('data-design-node="k5m5Bc"')
    expect(CREATE).toContain('data-design-node="MKrPY"')
    expect(BOOKINGS).toContain('data-design-node="i5SN2j"')
  })

  it('本文にタイトルと補足を重ねない', () => {
    expect(ALL).not.toContain("@/components/layout/header")
    expect(ALL).not.toContain('<Header')
  })

  it('一覧は実際に使える並び順・表示件数・ページ送りを持つ', () => {
    expect(LIST).toContain('開催日が近い順')
    expect(LIST).toContain('申込が多い順')
    expect(LIST).toContain('options={[10, 20, 50]')
    expect(LIST).toContain('`${value}件表示`')
    expect(LIST).toContain('<Pagination')
    expect(LIST).not.toContain('準備中')
  })

  it('予約者は既存のキャンセル待ちとCSVへ接続する', () => {
    expect(BOOKINGS).toContain('eventsApi.listWaitlist')
    expect(BOOKINGS).toContain('CSVで書き出す')
    expect(BOOKINGS).toContain("/^[=+\\-@]/")
    expect(BOOKINGS).not.toContain('予約者に一斉送信')
  })

  it('一覧の空・読込・失敗を同じ状態部品で扱う', () => {
    expect(LIST).toContain('<ListState kind="loading"')
    expect(LIST).toContain('<ListState kind="error"')
    expect(LIST).toContain('イベントがまだありません')
    expect(LIST).toContain('条件に合うイベントはありません')
  })
})
