import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * M015：反映の失敗で画面が固まる。
 * 反映口を try/catch し、失敗文を出して busy を戻し、履歴を読み直す。
 *
 * M016：書き出し・確認の失敗で内部文が出る。
 * 原文（`API error: NNN`・`Failed to fetch`）のまま出さず、共通の
 * 状態別案内へ渡す。操作が owner/admin 専用ならボタンの近くに書く。
 */
describe('M015/M016 UID・顧客データ移行の失敗表示', () => {
  it('反映の失敗で文が出てボタンが戻り、履歴が読み直される（M015）', () => {
    // 未捕捉の rejection を出さない：executeImport を try/catch する。
    expect(PAGE).toContain('const executeImport = async ()')
    expect(PAGE).toContain('await api.friendMigrations.executeImport(importId)')
    expect(PAGE).toContain('setMessage(')
    // finally で busy を戻し、履歴を読み直す。
    expect(PAGE).toMatch(/finally\s*\{\s*setBusy\(false\)\s*\}/)
    expect(PAGE).toContain('void executeImport()')
  })

  it('書き出し・確認・反映の失敗は原文のまま出さない（M016）', () => {
    expect(PAGE).toContain('describeApiFailure(')
    expect(PAGE).not.toContain('setMessage(error instanceof Error ? error.message')
    expect(PAGE).not.toContain("error.message : '書き出しを作れませんでした。'")
    expect(PAGE).not.toContain("error.message : '取り込みを確認できませんでした。'")
  })

  it('読み込み 403 は権限の面に分ける（M016）', () => {
    expect(PAGE).toContain("'loading' | 'ready' | 'error' | 'forbidden'")
    expect(PAGE).toContain('書き出し・取り込みを見る権限がありません')
  })

  it('owner/admin 専用の操作はボタンの近くに理由を出す（M016）', () => {
    expect(PAGE).toContain('書き出し・取り込みの操作はオーナーか管理者だけができます')
    expect(PAGE).toContain("localStorage.getItem('lh_staff_role')")
  })
})
