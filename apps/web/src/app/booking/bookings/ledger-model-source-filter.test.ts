import { describe, expect, it } from 'vitest'
import { ledgerSourceGroup, matchesLedgerFilters, matchesLedgerSource } from './ledger-model'

const row = (source: string | null, friendId: string | null = null, staffId = 'staff-1') => ({
  source, friend_id: friendId, staff_id: staffId,
})

describe('予約元の絞り込み', () => {
  it('LINE・電話・その他の3つにまとめる（友だちIDだけの古い応答もLINE）', () => {
    expect(ledgerSourceGroup(row('liff'))).toBe('line')
    expect(ledgerSourceGroup(row(null, 'friend-1'))).toBe('line')
    expect(ledgerSourceGroup(row('phone'))).toBe('phone')
    expect(ledgerSourceGroup(row('counter'))).toBe('other')
    expect(ledgerSourceGroup(row('operator'))).toBe('other')
    expect(ledgerSourceGroup(row('import'))).toBe('other')
  })

  it('すべては全件、それ以外はまとめた予約元で当てる', () => {
    expect(matchesLedgerSource(row('liff'), 'all')).toBe(true)
    expect(matchesLedgerSource(row('liff'), 'line')).toBe(true)
    expect(matchesLedgerSource(row('phone'), 'line')).toBe(false)
    expect(matchesLedgerSource(row('counter'), 'other')).toBe(true)
  })

  it('担当と予約元は両方に合うものだけを通す', () => {
    expect(matchesLedgerFilters(row('phone', null, 'staff-1'), 'staff-1', 'phone')).toBe(true)
    expect(matchesLedgerFilters(row('phone', null, 'staff-2'), 'staff-1', 'phone')).toBe(false)
    expect(matchesLedgerFilters(row('liff', null, 'staff-1'), 'staff-1', 'phone')).toBe(false)
    expect(matchesLedgerFilters(row('liff', null, 'staff-2'), 'all', 'line')).toBe(true)
  })
})
