import { describe, expect, it } from 'vitest'
import type { Preflight } from '@/lib/hq-templates-api'
import { choiceKey, contentSummary, resolvedItems } from './definition'

const preflight: Preflight = {
  preflightId: 'run', expiresAt: '2099-01-01T00:00:00.000Z',
  stores: [
    { accountId: 'a', accountName: 'A', items: [{ sourceId: 's', itemKind: 'template', name: 'お知らせ', duplicate: true, allowedModes: ['overwrite', 'alias'] }] },
    { accountId: 'b', accountName: 'B', items: [{ sourceId: 's', itemKind: 'template', name: 'お知らせ', duplicate: false, allowedModes: ['create'] }] },
  ],
}

describe('統括のテンプレート（★V8）の配り方', () => {
  it('重複は選ぶまで配れない。選べば重複でないものは「新しく作る」で配る', () => {
    expect(resolvedItems(preflight, {})).toBeNull()
    expect(resolvedItems(preflight, { [choiceKey('a', 's')]: 'overwrite' })).toEqual([
      { accountId: 'a', sourceId: 's', mode: 'overwrite' },
      { accountId: 'b', sourceId: 's', mode: 'create' },
    ])
  })

  it('許されていない配り方は選べない（上書きできない項目に上書きを指定しても配れない）', () => {
    const locked: Preflight = { ...preflight, stores: [{ ...preflight.stores[0], items: [{ ...preflight.stores[0].items[0], allowedModes: ['alias'] }] }] }
    expect(resolvedItems(locked, { [choiceKey('a', 's')]: 'overwrite' })).toBeNull()
  })

  it('配る表の「項目」は中身の短い言い方', () => {
    const base = { schemaVersion: 1 as const, template: { id: 'hq-authored-message', name: 'x', category: '', messageType: 'flex' as const, messageContent: 'x', carouselActionsJson: null, carouselTapLimitMode: 'none' as const, carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' as const }, media: [] }
    expect(contentSummary('template', base)).toBe('本文')
    expect(contentSummary('template', { ...base, media: [{ id: 'm', kind: 'image', filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, durationMs: null, r2Key: 'k', publicUrl: null, versionId: 'v', versionNo: 1, contentHash: 'h' }] })).toBe('本文・画像')
  })
})
