import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const list = readFileSync(new URL('./operator-notification-rules.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../app/line-notifications/page.tsx', import.meta.url), 'utf8')
const create = readFileSync(new URL('../../app/line-notifications/operator/new/page.tsx', import.meta.url), 'utf8')
const db = readFileSync(new URL('../../../../../packages/db/src/notifications.ts', import.meta.url), 'utf8')
const route = readFileSync(new URL('../../../../worker/src/routes/notifications.ts', import.meta.url), 'utf8')

describe('V6 運用者へのお知らせ — 安全な下書き接続', () => {
  it('4タブの2番目に運用者向けを置き、顧客向けと混ぜない', () => {
    expect(page).toMatch(/customer[\s\S]*operator[\s\S]*failures[\s\S]*history/)
    expect(page).toContain('<OperatorNotificationRules lineAccountId={selectedAccountId}')
  })

  it('V6の実Node IDを一覧と作成画面に固定する', () => {
    expect(list).toContain('data-design-node="DpxOK"')
    expect(create).toContain('data-design-node="N2gAza"')
  })

  it('一覧はアカウント別APIを読み、未取得を0件にしない', () => {
    expect(list).toContain('api.notifications.rules.list(lineAccountId)')
    expect(list).toContain("state === 'ready' ? rules.length : null")
    expect(list).toContain('kind="error"')
    expect(list).toContain('kind="forbidden"')
  })

  it('作成は下書きだけを保存し、公開・テスト送信を装わない', () => {
    expect(create).toContain("lifecycle: 'draft'")
    expect(create).toContain('下書きに保存')
    expect(create).not.toContain('運用者へのお知らせを公開')
    expect(create).not.toContain('自分へテスト送信')
  })

  it('新しいルールはDBで明示的に停止状態へ置く', () => {
    expect(db).toContain('line_account_id, is_active, created_at')
    expect(db).toContain('VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
  })

  it('送信処理の接続前にAPIから公開できない', () => {
    expect(route).toContain('body.isActive === true')
    expect(route).toContain('受け取る人と送信処理を接続するまで、運用者へのお知らせは公開できません')
  })

  it('本文側に大きな画面タイトルを重ねない', () => {
    expect(create).toContain("usePageTitle('運用者へのお知らせをつくる')")
    expect(create).not.toContain('<Header')
    expect(list).not.toContain('<Header')
  })
})
