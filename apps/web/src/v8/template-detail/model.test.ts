import { describe, expect, it } from 'vitest'
import { buildUsageRows, insertionNames, lineChanges, publishRowState, shortStamp } from './model'

const usage = {
  broadcasts: [{ broadcastId: 'b1', title: '9月の案内', status: 'scheduled', scheduledAt: null, templateVersionNumber: 2, referenceMode: 'fixed' as const }],
  autoReplies: [{ id: 'a1', keyword: '予約', matchType: 'exact' as const, lineAccountId: null, templateVersion: null }],
  automations: [{ id: 'o1', name: '古い自動処理', eventType: 'x' }],
  scenarioSteps: [{ scenarioId: 's1', scenarioName: 'フォロー', stepId: 'st1', stepOrder: 1, templateVersion: null }],
  reminderSteps: [],
  richMenuAreas: [],
  trackedLinks: [],
}

describe('テンプレートの詳細の計算', () => {
  it('使っている所は一斉配信→自動応答→シナリオ→…→旧オートメーションの順。版を決めた所と開けない所が分かる', () => {
    const rows = buildUsageRows(usage)
    expect(rows.map((r) => r.kind)).toEqual(['一斉配信', '自動応答', 'シナリオ配信', 'オートメーション'])
    expect(rows[0]).toMatchObject({ name: '9月の案内', fixed: true, version: '版2で固定（変わらない）', status: '予約中', href: '/broadcasts/reserved?id=b1' })
    expect(rows[2]).toMatchObject({ name: 'フォロー・1通目', fixed: false, version: 'いまの版' })
    expect(rows[3].href).toBeNull()
  })

  it('公開の窓の右：版を決めた所は「予約中・版2のまま」、ほかは状態だけ', () => {
    const rows = buildUsageRows(usage)
    expect(publishRowState(rows[0])).toBe('予約中・版2のまま')
    expect(publishRowState(rows[1])).toBe('')
  })

  it('変わるところ：消えた行は－、増えた行は＋。同じ行と空の行は出さない', () => {
    expect(lineChanges('A\nB\n\nC', 'A\nB2\nC\nD')).toEqual([
      { kind: 'removed', text: 'B' },
      { kind: 'added', text: 'B2' },
      { kind: 'added', text: 'D' },
    ])
    expect(lineChanges('同じ', '同じ')).toEqual([])
  })

  it('差し込みは同じ物を1つにまとめる・時刻は日本時間の「M月D日 H:MM」', () => {
    expect(insertionNames('{名前}さん {予約日時} {名前}')).toEqual(['名前', '予約日時'])
    expect(shortStamp('2026-08-21T09:02:00Z', new Date('2026-10-01T00:00:00Z'))).toBe('8月21日 18:02')
    expect(shortStamp('2025-08-21T09:02:00Z', new Date('2026-10-01T00:00:00Z'))).toBe('2025年8月21日 18:02')
    expect(shortStamp(null)).toBe('—')
  })
})
