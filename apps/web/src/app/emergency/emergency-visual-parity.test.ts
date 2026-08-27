import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('V6 32 運用状態の契約', () => {
  it('4つの実Nodeと共通タブを使い、本文タイトルを重ねない', () => {
    for (const node of ['UgonK', 'b3HfZ', 'UhC2O', 'U0BwS']) expect(source).toContain(node)
    expect(source).toContain('<MergedTabs')
    expect(source).not.toContain('<h1')
    expect(source).not.toContain('OperationPageHeader')
  })

  it('健全性の6項目を既存データから読み、取得失敗を正常にしない', () => {
    for (const label of ['LINE接続', '月間配信数', 'API・外部連携', 'Webhook', '配信処理', '友だち変化']) {
      expect(source).toContain(`label: '${label}'`)
    }
    expect(source).toContain('Promise.allSettled')
    expect(source).toContain("severity: 'unknown'")
    expect(source).toContain('item.isStale')
    expect(source).toContain('10分以内の確認結果がないLINEアカウント')
    expect(source).toContain('api.operations.control(null)')
  })

  it('緊急停止と復旧をサーバーAPIへ1回だけ依頼する', () => {
    expect(source).toContain('api.operations.stop({')
    expect(source).toContain('api.operations.restore(')
    expect(source).toContain("confirmation: '停止'")
    expect(source).toContain("confirmation: '復旧'")
    expect(source).not.toContain('api.broadcasts.update')
    expect(source).not.toContain('api.scenarios.update')
    expect(source).not.toContain('api.reminders.update')
    expect(source).not.toContain('api.automations.update')
  })

  it('ブラウザ内の停止正本と公開管理キーを使わない', () => {
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('NEXT_PUBLIC_ADMIN_API_KEY')
    expect(source).not.toContain('nen_emergency_snapshot')
    expect(source).not.toContain('nen_operation_history')
    expect(source).toContain('api.operations.history()')
  })

  it('既定停止は一斉・シナリオ・リマインダだけで、自動処理は明示選択にする', () => {
    expect(source).toContain('broadcast_dispatch: true')
    expect(source).toContain('scenario_dispatch: true')
    expect(source).toContain('reminder_dispatch: true')
    expect(source).toContain('automation_actions: false')
  })
})
