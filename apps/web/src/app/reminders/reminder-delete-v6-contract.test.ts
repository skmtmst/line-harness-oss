import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 リマインダ削除確認の契約', () => {
  it('設計 Y0Sn3 の共通確認ダイアログを使い、ブラウザ標準confirmへ戻さない', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).toContain('data-design-node="Y0Sn3"')
    expect(PAGE).not.toMatch(/\bconfirm\s*\(/)
  })

  it('未送信だけを取り消し、送信済み履歴を残すことを確認前に伝える', () => {
    expect(PAGE).toContain('未送信の通知予定はすべて取り消されます')
    expect(PAGE).toContain('送信済みの履歴は監査記録として残り')
    expect(PAGE).toContain('この操作は取り消せません')
    expect(PAGE).not.toContain('登録済みの配信予定も一緒に消えます')
  })

  it('1件と複数件を同じ削除経路へ通し、失敗時はダイアログを閉じない', () => {
    expect(PAGE).toContain('requestDelete([r])')
    expect(PAGE).toContain('requestDelete(reminders.filter')
    expect(PAGE).toContain('for (const reminder of pendingDelete)')
    expect(PAGE).toContain('setPendingDelete((previous) => previous.filter')
    expect(PAGE).toContain('状態を読み直してから、もう一度お試しください')
    expect(PAGE).not.toContain("setDeleteError(caught instanceof Error ? caught.message")
    expect(PAGE).toContain('error={deleteError}')
  })

  it('削除操作はownerとadminだけに表示する', () => {
    expect(PAGE).toContain("role === 'owner' || role === 'admin'")
    expect(PAGE).toContain('{canDelete ? (')
    expect(PAGE).toContain('{canDelete && (')
  })
})
