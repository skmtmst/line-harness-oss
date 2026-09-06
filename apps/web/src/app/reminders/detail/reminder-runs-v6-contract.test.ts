import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const API = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 7-1-H リマインダ実行結果', () => {
  it('Pencilの実Nodeと共通部品を正本にする', () => {
    expect(PAGE).toContain('data-design-node="GC4St"')
    expect(PAGE).toContain("@/components/shared/summary-card")
    expect(PAGE).toContain("@/components/shared/list-state")
    expect(PAGE).toContain("@/components/shared/pagination")
    expect(PAGE).toContain("@/components/shared/tabs")
  })

  it('本文に画面タイトルと説明を重ねない', () => {
    expect(PAGE).not.toMatch(/<h1[\s>]/)
    expect(PAGE).not.toContain('リマインダの実行結果</h1>')
    expect(PAGE).not.toContain('data-page-title')
    expect(PAGE).toContain("usePageTitle(data?.reminder.name ? `${data.reminder.name}・実行結果` : null)")
  })

  it('実行結果APIを読み、固定の設計値を画面へ埋め込まない', () => {
    expect(PAGE).toContain('api.reminders.runs(reminderId')
    expect(API).toMatch(/runs:\s*\(\s*\n?\s*reminderId: string,/)
    expect(PAGE).not.toContain('1,284')
    expect(PAGE).not.toContain('360人')
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
    expect(PAGE).toContain('LINEは友だち単位の既読を返しません')
    expect(PAGE).toContain('<Td align="right" title="LINEは友だち単位の既読を返しません">—</Td>')
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
    expect(PAGE).toContain('リマインダ一覧へ戻る')
  })
})
