import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(new URL('../../../v8/reminders/detail.tsx', import.meta.url), 'utf8')
/* 完全切り替え：v7 の一覧 page.tsx は捨て、V8 の list-v8.tsx を見る。 */
const LIST_PAGE = fs.readFileSync(path.join(__dirname, '..', 'list-v8.tsx'), 'utf8')
const API = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 7-1-H リマインダ実行結果', () => {
  it('一覧から予定と履歴を選べ、予定は公開APIのplannedで絞る', () => {
    expect(LIST_PAGE).toContain('status=planned')
    expect(LIST_PAGE).toContain('<RowMenu')
    expect(LIST_PAGE).toContain('items={rowMenuItems(row)}')
    // 削除は行に直に置かず、メニューの中の危ない操作にする。
    expect(LIST_PAGE).not.toContain('<Trash2 />')
    expect(LIST_PAGE).toContain("tone: 'danger'")
    expect(PAGE).toContain("const tab = tabFromParam(searchParams.get('tab'))")
    expect(PAGE).toContain("status: 'planned'")
    expect(PAGE).toContain('status: status || undefined')
    expect(PAGE).toContain("const hasErrors = data.summary.errors > 0")
  })

  it('画面へ返す状態はplannedで、DB内部のqueuedを公開契約へ漏らさない', () => {
    const statusType = API.match(/export type ReminderDeliveryRunStatus =[\s\S]*?\n\n/)?.[0] ?? ''
    expect(statusType).toContain("| 'planned'")
    expect(statusType).not.toContain("| 'queued'")
  })

  it('実行結果APIを読み、固定の設計値を画面へ埋め込まない', () => {
    expect(PAGE).toContain('api.reminders.runs(reminderId')
    expect(API).toMatch(/runs:\s*\(\s*\n?\s*reminderId: string,/)
    expect(PAGE).not.toContain('1,284')
    expect(PAGE).toContain("data.summary.sent")
    expect(PAGE).not.toContain('data?.summary.sent ?? 0')
  })

  it('7機能で再利用する9項目と6状態を共通契約にする', () => {
    for (const field of [
      'occurredAt', 'subject', 'accountLabel', 'triggerLabel', 'reference',
      'status', 'detail', 'durationMs', 'canRetry',
    ]) {
      expect(API).toContain(`${field}:`)
    }
    for (const status of ['succeeded', 'failed', 'partial', 'skipped', 'pending', 'cancelled']) {
      expect(API).toContain(`| '${status}'`)
    }
  })

  it('LINEで取れない友だち単位の既読率を0として作らない', () => {
    expect(PAGE).not.toContain('openRate ?? 0')
  })

  it('読込・失敗・空を区別し、失敗した1通だけ再試行できる', () => {
    expect(PAGE).toContain('<DetailLoading')
    // 対象の取得失敗は ★V7 TargetMissing の error（取り直し口つき）。
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('onRetry={() => void load()}')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain("crypto.randomUUID()")
    expect(PAGE).toContain('api.reminders.retryRun(runId')
    expect(PAGE).toContain("item.canRetry && canManage")
    expect(PAGE).toContain('setData(null)')
  })

  it('通知名を本文から出し、内部の友だちIDを画面へ出さない', () => {
    expect(PAGE).toContain('function stepLabel(')
    expect(PAGE).not.toContain('<span className={styles.cellSub}>{item.friendId}</span>')
  })

  it('操作名から行き先と結果が分かる', () => {
    expect(PAGE).toContain('api.reminders.update(reminderId, { isActive })')
  })
})
