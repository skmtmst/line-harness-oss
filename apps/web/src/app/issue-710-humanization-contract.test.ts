/*
 * Issue #710（監査6: 入力・表示の人間化残件）の契約テスト。
 * 1. 予約設定の「受付の締め切り」「キャンセルの期限」は分値のままだと
 *    1440分=24時間と読み取れない。入力の横に「＝24時間前」の読み替えを
 *    自動で出し、概要欄（時間前）と入力欄（分前）の単位割れを補う。
 * 2. タイムゾーンはIANA識別子の自由入力だと綴り違いで予約全体がずれる。
 *    選択式にし、保存済みの未知の値は候補へ足して守る。
 * 3. メディア容量は「2048.0 MB」のような4桁MBを出さず、1024MB超はGBへ
 *    切り替える1関数に統一する。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('Issue #710: 分の期限は人間化した読み替えを添える', () => {
  it('受付締切・キャンセル期限の入力へ読み替え関数をつなぐ', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).toContain('humanize={minutesBeforeLabel}')
    // RuleNumberField が読み替え行を描く
    expect(src).toContain('＝{hint}')
  })

  it('読み替え関数が正しい単位へ変換する', async () => {
    const { minutesBeforeLabel } = await import('./booking/lib/format-time')
    expect(minutesBeforeLabel(1440)).toBe('24時間前')
    expect(minutesBeforeLabel(90)).toBe('1時間30分前')
    expect(minutesBeforeLabel(2880)).toBe('2日前')
    expect(minutesBeforeLabel(30)).toBeNull()
  })
})

describe('Issue #710: タイムゾーンは選択式で綴り違いを防ぐ', () => {
  it('自由入力欄をやめて候補選択にし、未知の値は候補へ足す', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).not.toContain('placeholder="Asia/Tokyo"')
    expect(src).toContain('TIME_ZONE_CHOICES')
    // 保存済みの未知の値を黙って書き換えない仕組み
    expect(src).toContain('TIME_ZONE_CHOICES.includes(draft.timeZone)')
    expect(src).toContain("'Asia/Tokyo'")
  })

  it('IANAの一覧に無い値には綴り確認の注意を出す', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).toContain('isUnknownTimeZone(draft.timeZone)')
    expect(src).toContain('綴りを確認してください')
    expect(src).toContain('Asia/Tokyo')
  })
})

describe('Issue #710: 残りの分・時間の入力にも読み替えを添える', () => {
  it('仮押さえの保持時間・当日のお知らせへ読み替え関数をつなぐ', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).toContain('humanize={formatMinutesLengthHint}')
    expect(src).toContain('humanize={formatHoursBeforeHint}')
  })

  it('読み替え関数が正しい単位へ変換する', async () => {
    const { formatHoursBeforeHint, formatMinutesLengthHint } = await import('@/lib/format-duration')
    expect(formatMinutesLengthHint(1440)).toBe('1日')
    expect(formatMinutesLengthHint(30)).toBeNull()
    expect(formatHoursBeforeHint(72)).toBe('3日前')
    expect(formatHoursBeforeHint(2)).toBeNull()
  })
})

describe('Issue #710: 容量は1024MB超でGBへ切り替える1関数に統一', () => {
  it('formatMediaSize が GB を扱う', async () => {
    const { formatMediaSize } = await import('./contents/media-usage-display')
    expect(formatMediaSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
    expect(formatMediaSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('一覧・登録ダイアログの独自MB整形を廃止した', () => {
    const page = read('contents/page.tsx')
    const upload = read('contents/media-upload-dialog.tsx')
    expect(page).not.toContain('function formatStorage')
    expect(upload).not.toContain('(entry.file.size / 1024 / 1024).toFixed(1)')
    expect(upload).toContain('formatMediaSize(entry.file.size)')
  })
})
