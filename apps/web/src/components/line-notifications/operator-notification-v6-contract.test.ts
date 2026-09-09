import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const list = readFileSync(new URL('../../app/line-notifications/operator-notification-rules.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../app/line-notifications/page.tsx', import.meta.url), 'utf8')
const create = readFileSync(new URL('../../app/line-notifications/operator/new/page.tsx', import.meta.url), 'utf8')
const db = readFileSync(new URL('../../../../../packages/db/src/notifications.ts', import.meta.url), 'utf8')
const route = readFileSync(new URL('../../../../worker/src/routes/notifications.ts', import.meta.url), 'utf8')
const dispatch = readFileSync(new URL('../../../../worker/src/services/operator-notification-dispatch.ts', import.meta.url), 'utf8')

describe('V6 運用者へのお知らせ — 宛先・送信・実行記録の接続', () => {
  it('4タブの2番目に運用者向けを置き、顧客向けと混ぜない', () => {
    expect(page).toMatch(/customer[\s\S]*operator[\s\S]*failures[\s\S]*history/)
    expect(page).toContain('<OperatorNotificationRules lineAccountId={selectedAccountId}')
  })

  it('V6の実Node IDを一覧と作成画面に固定する', () => {
    expect(list).toContain('data-design-node="DpxOK"')
    expect(create).toContain('data-design-node="N2gAza"')
  })

  it('一覧はアカウント別の実行記録APIを読み、未取得を0件にしない', () => {
    expect(list).toContain('api.notifications.operatorRules.list(lineAccountId)')
    expect(list).toContain("state === 'ready' ? summary?.published ?? null : null")
    expect(list).toContain("summary?.total ?? '—'")
    expect(list).toContain('kind="error"')
    expect(list).toContain('kind="forbidden"')
    expect(list).toContain('data-list-state={listState}')
    expect(list).toContain('operatorRules.exportCsv(lineAccountId, exportReason.trim())')
  })

  it('作成は実在するスタッフを選び、下書き後に公開・本人テストできる', () => {
    expect(create).toContain("lifecycle: 'draft'")
    expect(create).toContain('下書きに保存')
    expect(create).toContain('operatorRules.previewRecipients')
    expect(create).toContain('operatorRules.publish')
    expect(create).toContain('operatorRules.test')
    expect(create).toContain('>出す</Button>')
    expect(create).toContain('自分にテスト送信')
    expect(create).toContain('LINEログイン済みの人にだけ届きます')
    expect(create).toContain('だれも受け取れないときはメールでも送る')
  })

  it('新しいルールはDBで明示的に停止状態へ置く', () => {
    expect(db).toContain('line_account_id, is_active, version, created_at')
    expect(db).toContain('VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)')
  })

  it('公開は専用APIだけで宛先を再検証し、実行記録を重複させない', () => {
    expect(route).toContain("notifications.post('/api/notifications/operator-rules/:id/publish'")
    expect(route).toContain("code: 'recipient_required'")
    expect(dispatch).toContain('claimOperatorDelivery')
    expect(dispatch).toContain('idempotency_key')
  })

  it('本文側に大きな画面タイトルを重ねない', () => {
    expect(create).toContain("usePageTitle('運用者へのお知らせをつくる')")
    expect(create).not.toContain('<Header')
    expect(list).not.toContain('<Header')
  })
})
