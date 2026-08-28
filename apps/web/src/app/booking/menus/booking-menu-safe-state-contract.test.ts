import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 予約メニューの取得状態', () => {
  it('一覧と付随する件数を未取得と実値0に分ける', () => {
    expect(PAGE).toContain("type SupportingLoadState = 'loading' | 'ready' | 'error'")
    expect(PAGE).toContain("supportingLoadState === 'ready' ? String(staff.length) : '—'")
    expect(PAGE).toContain("supportingLoadState === 'ready' ? String(kpi.inThis) : '—'")
    expect(PAGE).toContain("supportingLoadState === 'ready' ? `${bookingCounts.get(m.name) ?? 0} 件` : '—'")
  })

  it('APIの内部エラーを利用者へそのまま出さない', () => {
    expect(PAGE).toContain("setError(bookingErrorMessage(e, '読み込み'))")
    expect(PAGE).toContain("setErr(bookingErrorMessage(e, '保存'))")
    expect(PAGE).not.toContain('setError(e instanceof Error ? e.message')
  })

  it('アカウント切替時に前の件数と割り当てを残さない', () => {
    expect(PAGE).toContain('setStaff([])')
    expect(PAGE).toContain('setBookings([])')
    expect(PAGE).toContain('setMenuStaff(new Map())')
    expect(PAGE).toContain('setItems([])')
  })

  it('作り替えの覚え書きを利用者へ出さない', () => {
    expect(PAGE).not.toContain('旧デザインでは')
  })
})
