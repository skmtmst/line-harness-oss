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

  it('健全性の6項目を保存済み結果から読み、取得失敗を正常にしない', () => {
    for (const label of ['LINE接続', '月間配信数', 'API・外部連携', 'Webhook', '配信処理', '友だち変化']) {
      expect(source).toContain(`label: '${label}'`)
    }
    expect(source).toContain('Promise.allSettled')
    expect(source).toContain("severity: 'unknown'")
    expect(source).toContain('item.isStale')
    expect(source).toContain('10分以内の確認結果がないLINEアカウント')
    expect(source).toContain('api.operations.health()')
    expect(source).toContain('api.operations.runHealthCheck()')
    expect(source).not.toContain('api.dashboard.organizationOverview')
    expect(source).not.toContain('api.ecCommerce.overview')
    expect(source).not.toContain('api.webhooks.incoming.list')
    expect(source).not.toContain('api.broadcasts.list')
    expect(source).toContain('api.operations.control(null)')
  })

  it('保存済みアラートを表示して確認済みにし、停止結果の実数を履歴へ出す', () => {
    expect(source).toContain('api.operations.alerts()')
    expect(source).toContain('api.operations.acknowledgeAlert(alertId)')
    expect(source).toContain('確認済みにする')
    expect(source).toContain('const counts = incident.targetCounts')
    expect(source).toContain('counts.skippedDueToEmergency')
    expect(source).toContain('停止対象の実績を取得できません')
    expect(source).toContain('送信開始済み')
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

  it('停止前の実測人数を一覧と最終確認で共通表示し、確認直前に読み直す', () => {
    expect(source).toContain('setImpact(response.data.impact)')
    expect(source).toContain('const latest = await loadPreview()')
    expect(source).toContain('operationImpactText(key, impact)')
    expect(source.match(/operationImpactText\(key, impact\)/g)).toHaveLength(2)
    expect(source).toContain('別の端末で緊急停止されました')
  })

  it('専用権限をサーバーから読み、認証アプリの6桁コードで操作直前に再確認する', () => {
    expect(source).toContain('response.data.permissions.canControl')
    expect(source).toContain('api.auth.stepUp({ code: totpCode')
    expect(source).toContain("purpose: 'operation-stop'")
    expect(source).toContain("purpose: 'operation-restore'")
    expect(source).toContain('verified.data.stepUpToken')
    expect(source).toContain('認証アプリの6桁コード')
    expect(source).toContain('/^\\d{6}$/')
  })

  it('ブラウザ内の停止正本と公開管理キーを使わない', () => {
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('NEXT_PUBLIC_ADMIN_API_KEY')
    expect(source).not.toContain('nen_emergency_snapshot')
    expect(source).not.toContain('nen_operation_history')
    expect(source).toContain('api.operations.history()')
  })

  it('既定停止は一斉・シナリオ・リマインダだけで、自動処理と自動応答は明示選択にする', () => {
    expect(source).toContain('broadcast_dispatch: true')
    expect(source).toContain('scenario_dispatch: true')
    expect(source).toContain('reminder_dispatch: true')
    expect(source).toContain('automation_actions: false')
    expect(source).toContain('auto_reply_dispatch: false')
    expect(source).toContain("auto_reply_dispatch: { label: '自動応答'")
  })
})
