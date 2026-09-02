import { describe, expect, it } from 'vitest'
import {
  formatMileageChange,
  formatMileageDate,
  mileageEntryTypeLabel,
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
})
