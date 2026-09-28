import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('/health のアカウント別状態契約', () => {
  it('成功応答だけを正常・警告・危険として扱う', () => {
    expect(PAGE).toContain("value === 'normal' || value === 'warning' || value === 'danger'")
    expect(PAGE).toContain('isRiskLevel(payload.riskLevel)')
    expect(PAGE).toContain('isRiskLevel(logs[0]?.riskLevel)')
  })

  it('失敗と未設定を正常へ丸めない', () => {
    expect(PAGE).toContain("if (!response.success) return { state: 'error', logs: [] }")
    expect(PAGE).toContain(": 'unknown'")
    expect(PAGE).toContain("return [accountId, { state: 'error', logs: [] }] as const")
    expect(PAGE).toContain("const storedRisk = latestRisk[account.id] ?? 'unknown'")
    expect(PAGE).not.toContain("risks[account.id] = 'normal'")
    expect(PAGE).not.toContain("latestRisk[account.id] || 'normal'")
  })

  it('成功と失敗が混在してもアカウントごとの状態を保つ', () => {
    expect(PAGE).toContain('Promise.all(accountIds.map(async (accountId) => {')
    expect(PAGE).toContain('[accountId, resolveAccountHealth(await getHealth(accountId))]')
    expect(PAGE).toContain('Object.entries(snapshots).map(([accountId, snapshot]) => [accountId, snapshot.state])')
  })

  it('未確認・取得失敗を表示し、個別に再試行できる', () => {
    expect(PAGE).toContain("unknown: { label: '未確認'")
    expect(PAGE).toContain("error: { label: '取得失敗'")
    expect(PAGE).toContain('ヘルス情報を取得できませんでした。')
    expect(PAGE).toContain("? '再取得中...' : '再試行'")
    expect(PAGE).toContain('onClick={() => void retryAccountHealth(account.id)}')
  })

  /*
   * R168: 確認が止まっていても、24日前の「正常」が今の状態のように
   * 見えていた。cronは5分おきに走るので、最終確認がしきい値より古い
   * ものは結果ではなく「確認停止中」として区別する。
   */
  it('最終確認が古い記録は現在の状態として表示しない（R168）', () => {
    expect(PAGE).toContain('STALE_CHECK_AFTER_MS')
    expect(PAGE).toContain('isStaleCheck(')
    expect(PAGE).toContain("stale: { label: '確認停止中'")
    expect(PAGE).toContain("const stale = storedRisk !== 'unknown' && storedRisk !== 'error' && isStaleCheck(latestLog?.createdAt)")
  })

  it('最終確認の日時を常時出す（R168）', () => {
    expect(PAGE).toContain('最終確認')
    expect(PAGE).toContain('shortDateTime(latestLog.createdAt)')
    // 確認が止まっているときは、最後の結果と併せて現在は不明と伝える。
    expect(PAGE).toContain('確認が止まっているため、現在の状態は分かりません')
  })
})
