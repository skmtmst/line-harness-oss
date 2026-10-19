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
