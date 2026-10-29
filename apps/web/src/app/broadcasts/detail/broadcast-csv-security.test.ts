import { describe, expect, it } from 'vitest'
import { broadcastDetailCsv } from './broadcast-detail-export'
import { recipientCsv } from './broadcast-recipients'
import type { BroadcastRecipientRow } from '@/lib/api'

describe('F29: spreadsheet formulas remain text', () => {
  it.each(['=HYPERLINK("//evil.test")', '+SUM(1,2)', '-1+2', '@SUM(1)', '\t=1', '\r=1'])('escapes %j in recipient and summary CSV', title => {
    const recipients = recipientCsv([{ displayName: title, label: '届いた', detail: null, lineRequestId: null, dispatchedAt: null, settledAt: null } as BroadcastRecipientRow])
    expect(recipients).toContain(`"'${title.replaceAll('"', '""')}"`)
    const detail = broadcastDetailCsv({ title, status: 'sent', sentAt: null, scheduledAt: null, totalCount: 1, successCount: 1, delivered: 1, uniqueImpression: null, uniqueClick: null }, value => value ?? '—')
    expect(detail).toContain(`"'${title.replaceAll('"', '""')}"`)
  })
})

describe('宛先CSVの受付と未確認の区別', () => {
  const recipient = (group: BroadcastRecipientRow['group'], label: string): BroadcastRecipientRow => ({
    friendId: 'f1', displayName: '田中', lineAccountId: 'a1', group, label,
    detail: '記録された理由', retryable: false, lineRequestId: 'request-1', errorCode: null,
    dispatchedAt: '2026-10-01T01:00:00Z', settledAt: '2026-10-01T01:00:01Z',
  })

  it('既知の受付結果だけを直し、列・理由・要求ID・時刻とAPIの値は保つ', () => {
    const row = recipient('delivered', '届いた')
    const csv = recipientCsv([row])
    expect(csv).toBe('\uFEFF"名前","結果","理由","LINEの要求ID","送った時刻","結果が決まった時刻"\r\n"田中","LINEが受け付けました","記録された理由","request-1","2026-10-01T01:00:00Z","2026-10-01T01:00:01Z"\r\n')
    expect(row.label).toBe('届いた')
  })

  it('同じ文字列でも未確認groupは受付に変えず、失敗理由も保つ', () => {
    const csv = recipientCsv([recipient('unknown', '届いた'), recipient('failed_permanent', '届けられなかった')])
    expect(csv).toContain('"田中","届いた","記録された理由"')
    expect(csv).toContain('"田中","届けられなかった","記録された理由"')
    expect(csv).not.toContain('LINEが受け付けました')
  })
})
