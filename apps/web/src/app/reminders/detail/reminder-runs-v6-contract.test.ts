import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const LIST_PAGE = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')
const API = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 7-1-H リマインダ実行結果', () => {
  it('Pencilの実Nodeと共通部品を正本にする', () => {
    expect(PAGE).toContain('data-design-node="GC4St"')
    expect(PAGE).toContain("@/components/shared/breadcrumb")
    expect(PAGE).toContain("@/components/shared/card")
    expect(PAGE).toContain("@/components/shared/list-state")
    expect(PAGE).toContain("@/components/shared/pagination")
    expect(PAGE).toContain("@/components/reminders/reminder-v6-ui")
  })

  it('本文に画面タイトルと説明を重ねない', () => {
    expect(PAGE).not.toMatch(/<h1[\s>]/)
    expect(PAGE).not.toContain('リマインダの実行結果</h1>')
    expect(PAGE).not.toContain('data-page-title')
    expect(PAGE).toContain("`${data.reminder.name}・${isPlannedView ? '配信予定' : '実行結果'}`")
  })

  it('一覧から予定と履歴を選べ、予定は公開APIのplannedで絞る', () => {
    expect(LIST_PAGE).toContain('status=planned')
    expect(LIST_PAGE).toContain("label: '配信予定を確認'")
    expect(LIST_PAGE).toContain("label: '実行履歴を見る'")
    expect(LIST_PAGE).toContain('<ActionMenu')
    expect(LIST_PAGE).toContain('<MoreHorizontal />')
    expect(LIST_PAGE).toContain('<Trash2 />')
    expect(PAGE).toContain("const isPlannedView = searchParams.get('status') === 'planned'")
    expect(PAGE).toContain("setStatus(isPlannedView ? 'planned' : '')")
    expect(PAGE).toContain('status: status || undefined')
    expect(PAGE).toContain('>配信予定を見る</Button>')
    expect(PAGE).toContain('>実行履歴を見る</Button>')
    expect(PAGE).toContain("!isPlannedView && (data?.summary.errors ?? 0) > 0")
    expect(PAGE).toContain('予約や対象条件が変わると、予定も変わります。')
    expect(PAGE).not.toContain("data-design-node={isPlannedView ? 'JCz6J' : 'GC4St'}")
  })

  it('画面へ返す状態はplannedで、DB内部のqueuedを公開契約へ漏らさない', () => {
    const statusType = API.match(/export type ReminderDeliveryRunStatus =[\s\S]*?\n\n/)?.[0] ?? ''
    expect(statusType).toContain("| 'planned'")
    expect(statusType).not.toContain("| 'queued'")
    expect(PAGE).toContain("planned: { label: '配信予定', tone: 'info' }")
  })

  it('実行結果APIを読み、固定の設計値を画面へ埋め込まない', () => {
    expect(PAGE).toContain('api.reminders.runs(reminderId')
    expect(API).toMatch(/runs:\s*\(\s*\n?\s*reminderId: string,/)
    expect(PAGE).not.toContain('1,284')
    expect(PAGE).not.toContain('360人')
    expect(PAGE).toContain("value={data ? `${data.summary.sent.toLocaleString('ja-JP')}通` : '—'}")
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
    expect(PAGE).toContain('LINEでは友だち単位の既読を取得できません')
    expect(PAGE).not.toContain('<Th align="right">既読</Th>')
    expect(PAGE).not.toContain('openRate ?? 0')
  })

  it('読込・失敗・空を区別し、失敗した1通だけ再試行できる', () => {
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('<ListState kind="error"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain("crypto.randomUUID()")
    expect(PAGE).toContain('api.reminders.retryRun(runId')
    expect(PAGE).toContain('const canRetry = item.canRetry')
    expect(PAGE).toContain('通知実績を表示できませんでした')
    expect(PAGE).toContain('送る内容を表示できませんでした')
    expect(PAGE).toContain('setData(null)')
  })

  it('通知名を本文から出し、内部の友だちIDを画面へ出さない', () => {
    expect(PAGE).toContain('function stepLabel(')
    expect(PAGE).toContain("item.accountLabel ?? '所属アカウントは未取得'")
    expect(PAGE).not.toContain('<span className={styles.cellSub}>{item.friendId}</span>')
  })

  it('操作名から行き先と結果が分かる', () => {
    expect(PAGE).toContain('CSVで書き出す')
    expect(PAGE).toContain('この通知を再試行')
    expect(PAGE).toContain('リマインダの設定を編集')
    expect(PAGE).toContain("{ label: 'リマインダ一覧', href: '/reminders' }")
    expect(PAGE).toContain('リマインダを一時停止')
    expect(PAGE).toContain('api.reminders.update(reminderId, { isActive: false })')
  })
})
