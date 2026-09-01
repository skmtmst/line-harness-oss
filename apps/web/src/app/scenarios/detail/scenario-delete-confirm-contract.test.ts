import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./scenario-detail-client.tsx', import.meta.url), 'utf8')

describe('V6 dqFft シナリオ全体を削除する確認', () => {
  it('ブラウザ標準confirmを使わず安定した押し口から共通窓を開く', () => {
    expect(PAGE).not.toContain('if (!confirm(message)) return')
    expect(PAGE).toContain('data-qa-open="dqFft-scenario"')
    expect(PAGE).toContain('open={deleteScenarioOpen && scenario !== null}')
    expect(PAGE).toContain('confirmLabel="このシナリオを削除"')
    expect(PAGE).toContain('destructive')
  })

  it('未取得と実値0と購読中を同じ数字にせず削除の影響を読む', () => {
    expect(PAGE).toContain('stats?.activeNow === undefined')
    expect(PAGE).toContain('stats.activeNow === 0')
    expect(PAGE).toContain('購読中の人数は確認できません。')
    expect(PAGE).toContain('現在購読中の友だちは0人です。')
    expect(PAGE).toContain('人が購読中です。途中の人は続きを受け取れません。')
    expect(PAGE).toContain('シナリオの設定と今後の配信が削除されます。')
    expect(PAGE).toContain('これまでの配信履歴は監査記録として残ります。')
    expect(PAGE).toContain('この操作は取り消せません。')
  })

  it('二重削除を止め、成功時だけ閉じ、失敗は窓の中で日本語にする', () => {
    expect(PAGE).toContain('if (!scenario || deletingScenario) return')
    expect(PAGE).toContain('busy={deletingScenario}')
    expect(PAGE).toContain('error={deleteScenarioError}')
    expect(PAGE).toContain('if (!res.success) throw new Error(res.error)')
    expect(PAGE).toContain("setDeleteScenarioOpen(false)")
    expect(PAGE).toContain('このシナリオを削除できませんでした。状態を読み直してから')
    expect(PAGE).not.toContain("setError('削除に失敗しました')")
  })
})
