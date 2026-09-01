import { describe, expect, it } from 'vitest'
import {
  blockedReason,
  canDelete,
  checkedAtText,
  dialogTitle,
  NOT_AVAILABLE,
  referenceKindText,
  referenceNameText,
  usageText,
} from './media-delete-impact'

const impact = (over: Record<string, unknown> = {}) =>
  ({
    media: { id: 'm1', filename: '夏の定番セット.jpg', kind: 'image' },
    usageCount: 0, references: [], checkedAt: '2026-08-30T01:00:00.000Z',
    lastScannedAt: null, canDelete: true, recommendedAction: 'delete',
    ...over,
  }) as never

describe('使用中の言い方', () => {
  it('0件を「どこでも使っていません」と書く', () => {
    // 未取得と混ぜない。0件は確かめた結果。
    expect(usageText(impact())).toBe('どこでも使っていません。')
  })

  it('件数をそのまま出す', () => {
    expect(usageText(impact({ usageCount: 3 }))).toBe('いま 3か所で使われています。')
  })
})

describe('題', () => {
  it('消せないときは「削除しますか？」と聞かない', () => {
    // 聞いてから断るより、最初から消せないと言うほうが短い。
    expect(dialogTitle(impact({ canDelete: false }), 'a.jpg')).toBe('「a.jpg」は削除できません')
    expect(dialogTitle(impact(), 'a.jpg')).toBe('「a.jpg」を削除しますか？')
  })

  it('まだ読めていないときは、聞く形にしておく', () => {
    expect(dialogTitle(null, 'a.jpg')).toBe('「a.jpg」を削除しますか？')
  })
})

describe('使用先', () => {
  it('内部の記号をそのまま出さない', () => {
    for (const kind of ['template', 'broadcast', 'rich_menu', 'scenario_step', 'nen_column', 'event', 'webinar'] as const) {
      expect(referenceKindText(kind)).not.toMatch(/[a-z_]/)
    }
    expect(referenceKindText('rich_menu')).toBe('リッチメニュー')
  })

  it('名前が無い理由を書き分ける', () => {
    /*
     * 空欄にすると「名前の無い使用先」に見える。
     * 別アカウントで見せられないのか、まだ読めていないのかを分ける。
     */
    expect(referenceNameText({ kind: 'template', name: null, href: null, state: 'unavailable', scannedAt: '' }))
      .toContain('別のアカウント')
    expect(referenceNameText({ kind: 'template', name: null, href: null, state: 'available', scannedAt: '' }))
      .toBe(NOT_AVAILABLE)
    expect(referenceNameText({ kind: 'template', name: '夏の案内', href: null, state: 'available', scannedAt: '' }))
      .toBe('夏の案内')
  })
})

describe('消せない理由', () => {
  it('何をすればよいかを言う', () => {
    expect(blockedReason(impact({ canDelete: false }))).toContain('使用先から外して')
  })

  it('消せるときは理由を出さない', () => {
    expect(blockedReason(impact())).toBeNull()
  })
})

describe('確かめた時刻', () => {
  it('JSTで出す', () => {
    expect(checkedAtText('2026-08-30T01:00:00.000Z')).toContain('2026/08/30')
  })

  it('読めなければ「—（未取得）」', () => {
    expect(checkedAtText('こわれた日付')).toBe(NOT_AVAILABLE)
  })
})

describe('消してよいか', () => {
  it('canDelete と usageCount の両方を見る', () => {
    expect(canDelete({ impact: impact(), busy: false })).toBe(true)
    expect(canDelete({ impact: impact({ canDelete: false }), busy: false })).toBe(false)
    // 使用先が残っているのに canDelete だけ立っている組み合わせを通さない。
    expect(canDelete({ impact: impact({ usageCount: 1 }), busy: false })).toBe(false)
  })

  it('読み込めていないときと送信中は押せない', () => {
    expect(canDelete({ impact: null, busy: false })).toBe(false)
    expect(canDelete({ impact: impact(), busy: true })).toBe(false)
  })
})
