import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 予約メニューの取得状態', () => {
  it('一覧と店舗設定を別々に待ち、一覧は一覧の応答だけで出す (DEEP-26)', () => {
    expect(PAGE).toContain("type SupportingLoadState = 'loading' | 'ready' | 'error'")
    // 一覧(listMenus)と設定(getSettings)を Promise.all で束ねない。
    // 設定が遅れても、取れている一覧を隠さない。
    expect(PAGE).not.toContain('await Promise.all([')
    expect(PAGE).toContain('settingsLoadState')
    expect(PAGE).toContain("setSettingsLoadState('ready')")
    expect(PAGE).toContain("value={favorite?.name ?? '—'}")
    expect(PAGE).toContain('`${bookingCounts.get(m.id) ?? 0} 件`')
  })

  it('APIの内部エラーを利用者へそのまま出さない', () => {
    expect(PAGE).toContain("setError(bookingErrorMessage(e, '読み込み'))")
    expect(PAGE).toContain("setErr(bookingErrorMessage(e, '保存'))")
    expect(PAGE).not.toContain('setError(e instanceof Error ? e.message')
  })

  it('アカウント切替時に前の件数と割り当てを残さない', () => {
    expect(PAGE).toContain('setMenuStaff(new Map())')
    expect(PAGE).toContain('setItems([])')
  })

  it('担当と30日件数はメニュー一覧の集計だけを使い、予約明細を運ばない', () => {
    expect(PAGE).toContain('menu.assigned_staff ?? []')
    expect(PAGE).toContain('menu.booking_count_30_days ?? 0')
    expect(PAGE).not.toContain('bookingApi.listMenuStaff')
    expect(PAGE).not.toContain("bookingApi.listRequests(selectedAccountId, 'all')")
  })

  it('切替前のアカウントから遅れて届いた一覧を表示しない', () => {
    expect(PAGE).toContain('const requestGeneration = ++loadGenerationRef.current')
    expect(PAGE).toContain('if (loadGenerationRef.current !== requestGeneration) return')
    expect(PAGE).toContain('if (loadGenerationRef.current === requestGeneration) setLoading(false)')
  })

  it('作り替えの覚え書きを利用者へ出さない', () => {
    expect(PAGE).not.toContain('旧デザインでは')
  })
})
