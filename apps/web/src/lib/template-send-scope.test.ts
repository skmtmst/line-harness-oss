import { describe, expect, it } from 'vitest'
import {
  filterSendableTemplates,
  isSendableTemplate,
} from './template-send-scope'

/**
 * 送信候補の選び方(#645 差し戻し・要件1/4)。
 * 公開版だけを候補にし、未公開・他アカウントを混ぜない。
 */
describe('isSendableTemplate', () => {
  it('公開済みの同じアカウントは候補になる', () => {
    expect(
      isSendableTemplate(
        { id: 't1', accountId: 'account-1', publishedVersion: 1, publishedAt: '2026-09-01T00:00:00+09:00' },
        'account-1',
      ),
    ).toBe(true)
  })

  it('未公開(公開日時なし・版0)は候補にしない', () => {
    expect(
      isSendableTemplate(
        { id: 't-new', accountId: 'account-1', publishedVersion: 0, publishedAt: null },
        'account-1',
      ),
    ).toBe(false)
  })

  it('違うアカウントの公開済みは候補にしない', () => {
    expect(
      isSendableTemplate(
        { id: 't-other', accountId: 'account-2', publishedVersion: 3, publishedAt: '2026-09-01T00:00:00+09:00' },
        'account-1',
      ),
    ).toBe(false)
  })

  it('目印がない古い応答は通す(撮影用モックの絵を保つ)', () => {
    expect(isSendableTemplate({ id: 't-mock' }, 'account-1')).toBe(true)
  })
})

describe('filterSendableTemplates', () => {
  it('順番を保って送れるものだけを残す', () => {
    const rows = [
      { id: 'unpublished', accountId: 'account-1', publishedVersion: 0, publishedAt: null },
      { id: 'mine', accountId: 'account-1', publishedVersion: 2, publishedAt: '2026-09-01T00:00:00+09:00' },
      { id: 'other', accountId: 'account-2', publishedVersion: 2, publishedAt: '2026-09-01T00:00:00+09:00' },
    ]
    expect(filterSendableTemplates(rows, 'account-1').map((row) => row.id)).toEqual(['mine'])
  })
})
