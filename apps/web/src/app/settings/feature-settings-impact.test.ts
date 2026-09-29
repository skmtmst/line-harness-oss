import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createAccountRequestGuard } from './account-request-guard'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
const apiSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'api.ts'), 'utf8')

describe('機能設定のオフ前影響確認(#643)', () => {
  it('共通の確認ダイアログを使い、標準の確認は使わない', () => {
    expect(source).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(source).toContain('<ConfirmDialog')
    expect(source).toContain('オフにする前に確認')
    expect(source).toContain('確認して保存')
    expect(source).not.toContain('confirm(')
    expect(source).not.toContain('alert(')
  })

  it('オフに変わる機能があるときだけ影響確認し、止まる仕事があれば止める', () => {
    expect(source).toContain('/api/settings/features/impact')
    expect(source).toContain("method: 'POST'")
    expect(source).toContain('requiresConfirmation')
    expect(source).toContain('setImpactOpen(true)')
    expect(source).toContain('savedFeatures[key] === true && features[key] === false')
  })

  it('確認して保存するときだけトークンを付け、状態変化では確認し直す', () => {
    expect(source).toContain('impactToken')
    expect(source).toContain('IMPACT_CONFIRMATION_REQUIRED')
    expect(source).toContain('状態が変わったため、内容を確認し直してください')
    // 影響確認は件数と対象種別だけを見せ、内部IDは表示名に置き換える。
    expect(source).toContain('featureLabelByKey')
    expect(source).toContain('impactSummary')
  })

  it('影響0の保存はそのまま通り、競合時は従来どおり読み直す', () => {
    expect(source).toContain('expectedVersion: settingsVersion')
    expect(source).toContain('sidebarItemOrder: currentOrder')
    expect(source).toContain('error instanceof ApiError && error.status === 409')
    expect(source).toContain('setError(FEATURE_SETTINGS_CONFLICT_MESSAGE)')
    expect(source).toContain("featureSettingsErrorMessage(error instanceof ApiError ? error.status : undefined, 'save')")
  })

  it('呼び出し層は変えない(所有パス外の変更なし)', () => {
    expect(apiSource).not.toContain('settings/features/impact')
    expect(apiSource).not.toContain('impactToken')
  })

  it('非同期の応答にアカウント切替の世代guardを付ける', () => {
    // preview・再読込・保存の入口すべてで切符を取る。
    expect(source.split('accountGuard.issue(selectedAccountId)').length - 1).toBeGreaterThanOrEqual(5)
    expect(source).toContain('accountGuard.isCurrent(ticket, selectedAccountId)')
    expect(source).toContain('accountGuard.advance()')
  })

  it('Aで取った応答をBへ混ぜず、Aの版でBへ保存しない', async () => {
    const guard = createAccountRequestGuard()
    // Aで読み始める。
    const ticketA = guard.issue('account-a')
    expect(guard.isCurrent(ticketA, 'account-a')).toBe(true)
    // Bへ切り替える。
    guard.advance()
    // 遅れて届いたAの応答は捨てる。
    expect(guard.isCurrent(ticketA, 'account-a')).toBe(false)
    // Aの切符をBの画面に使えない。
    expect(guard.isCurrent(ticketA, 'account-b')).toBe(false)
    // Bで取り直した応答だけ通る。
    const ticketB = guard.issue('account-b')
    expect(guard.isCurrent(ticketB, 'account-b')).toBe(true)
    expect(guard.isCurrent(ticketB, 'account-a')).toBe(false)
    // Aに戻っても古い切符は復活しない。
    guard.advance()
    expect(guard.isCurrent(ticketA, 'account-a')).toBe(false)
  })
})
