/*
 * 反映履歴の日時が、端末の時計に関係なく日本時間で出ること。
 *
 * 検証環境で 15:00 と書いたものが 13:00 と出た。端末が +07 で、
 * ローカル時刻に直して表示していたため。海外から見た人と日本にいる人で
 * 違う時刻が出ると、「何時に入ったのか」が食い違う。
 *
 * 画面の関数をそのまま呼べないので、同じ組み立てをここで再現して見る。
 * 表示の分岐（時刻ありなし）と、時間帯の固定の2つが要点。
 */
import { describe, it, expect } from 'vitest'

/** release-log-panel.tsx の formatWhen と同じ組み立て。 */
function formatWhen(value: string | null, fallback = ''): string {
  if (!value) return fallback
  const hasTime = /[ T]\d{2}:\d{2}/.test(value)
  const iso = value.replace(' ', 'T')
  const date = new Date(hasTime ? `${iso}:00+09:00` : `${iso}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

describe('反映履歴の日時', () => {
  it('書いたとおりの時刻が出る（端末の時計に引きずられない）', () => {
    const out = formatWhen('2026-08-19 15:00')
    expect(out).toContain('15:00')
    expect(out).toContain('8月19日')
  })

  it('日付だけなら時刻を出さない', () => {
    const out = formatWhen('2026-08-19')
    expect(out).toContain('8月19日')
    expect(out).not.toMatch(/\d{2}:\d{2}/)
  })

  it('日をまたぐ時刻でも日付がずれない', () => {
    // +07 の端末でローカル表示すると 8月19日 22:00 になってしまう値。
    expect(formatWhen('2026-08-20 00:30')).toContain('8月20日')
  })

  it('T区切りでも空白区切りでも同じに読む', () => {
    expect(formatWhen('2026-08-19T15:00')).toBe(formatWhen('2026-08-19 15:00'))
  })

  it('空なら控えの文字を出す', () => {
    expect(formatWhen(null, '次回反映予定')).toBe('次回反映予定')
  })

  it('読めない値はそのまま出す（握りつぶさない）', () => {
    expect(formatWhen('あとで')).toBe('あとで')
  })
})
