import { describe, expect, it } from 'vitest'

import type { ApiBroadcast } from '@/lib/api'
import { broadcastBelongsToSelectedAccount } from './broadcast-detail-account'

const base = {
  id: 'broadcast-1',
  title: 'お知らせ',
  messageType: 'text',
  messageContent: '本文',
  targetType: 'all',
  targetTagId: null,
  status: 'sent',
  scheduledAt: null,
  sentAt: '2026-08-01T00:00:00Z',
  totalCount: 10,
  successCount: 10,
  createdAt: '2026-08-01T00:00:00Z',
  accountIds: null,
  dedupPriority: null,
  failedAccountIds: null,
  trackLinks: true,
} as ApiBroadcast

describe('一斉配信詳細のLINEアカウント境界', () => {
  it('単一アカウント配信は同じアカウントだけに表示する', () => {
    expect(broadcastBelongsToSelectedAccount({ ...base, lineAccountId: 'account-a' }, 'account-a')).toBe(true)
    expect(broadcastBelongsToSelectedAccount({ ...base, lineAccountId: 'account-a' }, 'account-b')).toBe(false)
  })

  it('複数アカウント配信は対象に含まれるアカウントだけに表示する', () => {
    const broadcast = {
      ...base,
      targetType: 'multi-account-dedup',
      lineAccountId: null,
      accountIds: ['account-a', 'account-b'],
    } as ApiBroadcast
    expect(broadcastBelongsToSelectedAccount(broadcast, 'account-b')).toBe(true)
    expect(broadcastBelongsToSelectedAccount(broadcast, 'account-c')).toBe(false)
  })

  it('アカウント未記録の旧データは既存の詳細URLを失わない', () => {
    expect(broadcastBelongsToSelectedAccount({ ...base, lineAccountId: null }, 'account-a')).toBe(true)
  })
})
