import { describe, expect, it } from 'vitest'
import {
  actionScoreReasonLabel,
  formatMileageChange,
  formatMileageDate,
  formatMileageMonthDay,
  formatMileageNumber,
  formatMileageShortDateTime,
  mileageEntryTypeLabel,
  mileageRankProgress,
  mileageSourceLabel,
  mileageSourceNoteText,
  mileageStatusLabel,
} from './mileage-display'

describe('マイル履歴の表示', () => {
  it('内部値を運用者向けの言葉へ変える', () => {
    expect(mileageEntryTypeLabel('reversal')).toBe('取消')
    expect(mileageStatusLabel('pending')).toBe('確定待ち')
    expect(mileageSourceLabel('line_relationship')).toBe('友だち登録・継続')
    expect(mileageSourceLabel('unknown_pipeline')).toBe('その他の自動処理')
  })

  it('発生元の補足に調整元IDを出さない', () => {
    // 問い合わせ番号・注文番号そのもの。運用者がこの表で読む値ではない。
    expect(mileageSourceNoteText({ sourceReferenceId: 'INQ-20260823-018', hasSourceEvent: false }))
      .toBe('元の記録あり')
    expect(mileageSourceNoteText({ sourceReferenceId: 'ORD-20260822-0007', hasSourceEvent: false }))
      .not.toMatch(/ORD-|INQ-|調整元ID/)
    expect(mileageSourceNoteText({ sourceReferenceId: null, hasSourceEvent: true }))
      .toBe('元の記録あり')
    expect(mileageSourceNoteText({ sourceReferenceId: null, hasSourceEvent: false }))
      .toBe('元の記録なし')
    // 空白だけの番号は「記録あり」にしない。
    expect(mileageSourceNoteText({ sourceReferenceId: '  ', hasSourceEvent: false }))
      .toBe('元の記録なし')
  })

  it('増減と日時を誤読しない形で表示する', () => {
    expect(formatMileageChange(1200)).toBe('+1,200')
    expect(formatMileageChange(-50)).toBe('−50')
    expect(formatMileageDate('2026-08-25T11:00:00.000Z')).toContain('20:00')
    expect(formatMileageDate('invalid')).toBe('—')
  })

  it('短い日時は絵どおりに出す（9/30 14:12・9/30）', () => {
    /* 絵の板 `oRbJi`・`R6kIG`・`IRPw8`。日本時間に直す。 */
    expect(formatMileageShortDateTime('2026-09-30T05:12:00.000Z')).toBe('9/30 14:12')
    expect(formatMileageShortDateTime('2026-10-02T06:20:00.000Z')).toBe('10/2 15:20')
    expect(formatMileageShortDateTime(null)).toBe('—')
    expect(formatMileageShortDateTime('invalid')).toBe('—')
    expect(formatMileageMonthDay('2026-12-31T00:00:00.000Z')).toBe('12/31')
    expect(formatMileageMonthDay(null)).toBe('—')
  })

  it('取れていない数・壊れた数を0にせず「—」で表示する', () => {
    expect(formatMileageNumber(1234567)).toBe('1,234,567')
    expect(formatMileageNumber(0)).toBe('0')
    expect(formatMileageNumber(null)).toBe('—')
    expect(formatMileageNumber(undefined)).toBe('—')
    expect(formatMileageNumber(Number.NaN)).toBe('—')
  })
})

describe('行動スコアの理由表示（IDEA-17）', () => {
  it('「きっかけ → ルール名」はルール名だけを出す', () => {
    expect(actionScoreReasonLabel('message_received → 返信スコア')).toBe('返信スコア')
    expect(actionScoreReasonLabel('link_clicked → クリック加点')).toBe('クリック加点')
  })

  it('内部のイベント名だけの値は汎用の言葉へ、理由なしは未取得と区別する', () => {
    expect(actionScoreReasonLabel('unknown_event_key')).toBe('反応の記録')
    expect(actionScoreReasonLabel(null)).toBe('点数が変わった理由は未取得')
  })

  it('担当者が書いた日本語の理由はそのまま出す', () => {
    expect(actionScoreReasonLabel('問い合わせ対応のお詫び')).toBe('問い合わせ対応のお詫び')
  })
})

describe('ランクの進み表示（R54）', () => {
  it('未公開は最高到達と言わず、2行目は作り先の案内に譲る', () => {
    // 口は rank も nextRank も null、理由は「公開中のランクがありません」を返す。
    const result = mileageRankProgress({
      rank: null,
      rankReason: '公開中のランクがありません',
      nextRankLabel: null,
      milesToNextRank: null,
    })
    expect(result.headline).toBe('公開中のランクがありません')
    expect(result.headline).not.toBe('いちばん上のランクです')
    expect(result.detail).toBeNull()
    expect(result.unpublished).toBe(true)
  })

  it('最高到達は「いちばん上」と言い、理由を2行目に出す', () => {
    const result = mileageRankProgress({
      rank: 'ゴールド',
      rankReason: '5,000マイル以上',
      nextRankLabel: null,
      milesToNextRank: null,
    })
    expect(result.headline).toBe('いちばん上のランクです')
    expect(result.detail).toBe('5,000マイル以上')
    expect(result.unpublished).toBe(false)
  })

  it('次のランクがあるときは次と残りマイルを出す', () => {
    const result = mileageRankProgress({
      rank: null,
      rankReason: '最初のランクに届いていません',
      nextRankLabel: 'ブロンズ',
      milesToNextRank: 800,
    })
    expect(result.headline).toBe('次は「ブロンズ」')
    expect(result.detail).toBe('あと 800 マイル')
    expect(result.unpublished).toBe(false)
  })

  it('取れていないときは確認できないと言い、未公開扱いにしない', () => {
    const result = mileageRankProgress({
      rank: undefined,
      rankReason: undefined,
      nextRankLabel: undefined,
      milesToNextRank: undefined,
    })
    expect(result.headline).toBe('ランク情報を確認できません')
    expect(result.detail).toBe('ランク情報を確認できません')
    expect(result.unpublished).toBe(false)
  })
})
