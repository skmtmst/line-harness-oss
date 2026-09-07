import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type {
  ApiResponse,
  IdentityCandidateKind,
  IdentityCandidateList,
  IdentityCandidateListItem,
} from '@line-crm/shared'
import { fetchAllIdentityCandidates } from './identity-review'

const directory = dirname(fileURLToPath(import.meta.url))
const hookSource = readFileSync(join(directory, 'identity-review.tsx'), 'utf8')
const ecSource = readFileSync(join(directory, '..', '..', 'app', 'ec-commerce', 'identity-candidates', 'page.tsx'), 'utf8')
const friendSource = readFileSync(join(directory, '..', '..', 'app', 'friends', 'identity-candidates', 'page.tsx'), 'utf8')

function item(id: string, lineAccountId: string | null): IdentityCandidateListItem {
  const subject = {
    kind: 'ec_event' as const,
    id: `left-${id}`,
    label: `注文 ${id}`,
    detail: null,
    lineAccountId,
    lineAccountName: null,
    shopKey: null,
    attributes: [],
  }
  return {
    id,
    kind: 'ec_member',
    status: 'pending',
    version: 1,
    confidence: { score: 80, label: 'high' },
    left: subject,
    right: { ...subject, id: `right-${id}` },
    evidenceSummary: ['メールが同じ'],
    detectedAt: '2026-08-30T10:00:00.000Z',
    reviewedAt: null,
  }
}

type FetchPage = (params: {
  kind: IdentityCandidateKind
  status: 'pending'
  limit: number
  offset: number
}) => Promise<ApiResponse<IdentityCandidateList>>

function ok(items: IdentityCandidateListItem[], total: number): ApiResponse<IdentityCandidateList> {
  return { success: true, data: { items, total, limit: 100, offset: 0 } }
}

describe('つき合わせの全頁取得(#530)', () => {
  it('複数頁を集め、offsetを進める', async () => {
    const seenOffsets: number[] = []
    const page1 = Array.from({ length: 100 }, (_, index) => item(`c-${index}`, 'account-a'))
    const page2 = [item('c-100', 'account-a')]
    const fetchPage: FetchPage = async ({ offset }) => {
      seenOffsets.push(offset)
      return offset === 0 ? ok(page1, 101) : ok(page2, 101)
    }
    const all = await fetchAllIdentityCandidates(fetchPage, 'ec_member')
    expect(all).toHaveLength(101)
    expect(seenOffsets).toEqual([0, 100])
  })

  it('offsetを無視する口でも重複で止まる', async () => {
    let calls = 0
    const page = Array.from({ length: 100 }, (_, index) => item(`c-${index}`, 'account-a'))
    const fetchPage: FetchPage = async () => {
      calls += 1
      return ok(page, 250)
    }
    const all = await fetchAllIdentityCandidates(fetchPage, 'ec_member')
    expect(all).toHaveLength(100)
    expect(calls).toBe(2)
  })

  it('失敗したら投げて、呼び手が失敗表示にできる', async () => {
    const fetchPage: FetchPage = async () => ({ success: false, error: '落ちた' })
    await expect(fetchAllIdentityCandidates(fetchPage, 'ec_member')).rejects.toThrow('落ちた')
  })

  it('空なら1回で終わる', async () => {
    let calls = 0
    const fetchPage: FetchPage = async () => {
      calls += 1
      return ok([], 0)
    }
    await expect(fetchAllIdentityCandidates(fetchPage, 'ec_member')).resolves.toEqual([])
    expect(calls).toBe(1)
  })
})

describe('つき合わせの絞り配線(#530)', () => {
  it('EC画面は選んだアカウントをhookへ渡す', () => {
    expect(ecSource).toContain("useIdentityReview('ec_member', {")
    expect(ecSource).toContain('lineAccountId: selectedAccountId')
  })

  it('hookはアカウント指定のとき全頁取得へ寄せる', () => {
    expect(hookSource).toContain('fetchAllIdentityCandidates')
    expect(hookSource).toContain('item.left.lineAccountId === lineAccountId')
  })

  it('友だち同士の画面は従来どおり先頭だけ読む', () => {
    expect(friendSource).toContain("useIdentityReview('friend_duplicate')")
    expect(friendSource).not.toContain('lineAccountId:')
  })
})
