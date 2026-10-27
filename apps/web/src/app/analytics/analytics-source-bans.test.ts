import { readApiSource } from '../../../scripts/test-api-source.mjs'
import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * 分析の画面に戻してはいけない書き方の見張り（入っていないことだけを見る）。
 * 画面の動き（未取得を0にしない・待ち順・判定不能・版ずれ・期間と締切など）は
 * analytics-screen-react.test.tsx と analytics-cross-react.test.tsx が描いて確かめる。
 */
const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readApiSource(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('分析の画面に戻さない書き方', () => {
  it('旧集計の口と旧ファネルの口を使わない', () => {
    expect(API).not.toContain('`/api/analytics/cross?account_id=')
    expect(PAGE).not.toContain('api.funnels.create')
    expect(PAGE).not.toContain('api.funnels.result')
  })

  it('本文に題を重ねず、つないでいない外部の名前を出さない', () => {
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('Google Analytics')
    expect(PAGE).not.toContain('保存した分析はまだ接続されていません')
  })

  it('結果待ちは間隔を決めずに叩き続けず、送り直しを促す古い文言を出さない', () => {
    expect(PAGE).not.toContain('setInterval')
    expect(PAGE).not.toContain('attempts >= 40')
    expect(PAGE).not.toContain('時間切れです')
    expect(PAGE).not.toContain('まもなく終わります')
    // 絶対順位と誤認させる古い待ち順の言い方
    expect(PAGE).not.toContain('待ち順は')
    expect(PAGE).not.toContain('目安は約')
  })

  it('未取得の言い方は「未取得」にそろえる', () => {
    expect(PAGE).not.toContain('を取得できません')
    expect(PAGE).not.toContain('取得不可')
    // 「定義が古い」は版ずれだけ。未取得・失敗とは別の軸。
    expect(PAGE).not.toContain('未取得・失敗の最新結果')
    expect(PAGE).not.toContain("['unavailable', 'failed'].includes(item.latestSnapshot.state)")
  })

  it('「止まった人」を到達の差で数えない', () => {
    expect(PAGE).not.toContain('prev - result[i].reached')
  })

  it('曜日と日付を端末の地域で決めない', () => {
    expect(PAGE).not.toContain('getDay()')
    expect(PAGE).not.toContain('toLocaleDateString')
  })

  it('クリック率を百分率へ二重に直さず、分析表に横スクロールを作らない', () => {
    expect(PAGE).not.toContain('<MetricCell metric={item.clickRate} percent')
    expect(PAGE).not.toContain('overflow-x-auto')
    expect(PAGE).not.toContain('min-w-[600px]')
    expect(PAGE).not.toContain('min-w-[760px]')
  })
})
