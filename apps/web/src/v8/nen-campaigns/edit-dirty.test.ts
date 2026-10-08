/*
 * 監査 WEB230：保存のあと版（updatedAt）だけが新しくなっても、「直しかけ」と言わない。
 */
import { describe, expect, it } from 'vitest'
import { withoutVersion } from './edit'

describe('配信を直すの直しかけ（WEB230）', () => {
  it('版だけ違うときは同じ中身', () => {
    const saved = { campaignKey: 'k', title: 'お知らせ', updatedAt: '2026-10-08T01:00:00Z' }
    const draft = { campaignKey: 'k', title: 'お知らせ', updatedAt: '2026-10-01T00:00:00Z' }
    expect(JSON.stringify(withoutVersion(draft))).toBe(JSON.stringify(withoutVersion(saved)))
  })
  it('中身が違えば違う（対照）', () => {
    expect(JSON.stringify(withoutVersion({ title: 'A', updatedAt: 'x' }))).not.toBe(JSON.stringify(withoutVersion({ title: 'B', updatedAt: 'x' })))
  })
})
