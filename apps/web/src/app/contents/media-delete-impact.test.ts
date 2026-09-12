import { describe, expect, it } from 'vitest'
import {
  blockedReason,
  canDelete,
  checkedAtText,
  dialogTitle,
  NOT_AVAILABLE,
  referenceKindText,
  referenceNameText,
  summarizeBulkDeleteResult,
  usageText,
} from './media-delete-impact'
import { mediaUsageKindText } from './media-usage-display'

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

  it('#550 M4 「シナリオの通」ではなく「シナリオのステップ」と書く', () => {
    // 削除の窓と詳細画面で同じ使用先が違う名前に見えていた。
    expect(referenceKindText('scenario_step')).toBe('シナリオのステップ')
  })

  it('#550 M4 種別の言い方は使用箇所の1つの表と同じにする', () => {
    // 表を2か所に置くと、片方だけ直して食い違いが再発する。
    for (const kind of ['template', 'broadcast', 'rich_menu', 'scenario_step', 'nen_column', 'event', 'webinar'] as const) {
      expect(referenceKindText(kind)).toBe(mediaUsageKindText(kind))
    }
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

describe('#550 M3 まとめて削除の結果文', () => {
  it('全部消せたら成功の文にする', () => {
    expect(summarizeBulkDeleteResult(3, [])).toEqual({ tone: 'success', message: '削除しました（3件）' })
  })

  it('一部失敗したら成功数と失敗した名前を残す', () => {
    // 件ごとに上書きすると最後の1件しか残らない。
    expect(summarizeBulkDeleteResult(1, ['a.png', 'b.png'])).toEqual({
      tone: 'error',
      message: '削除しました1件、失敗2件（a.png、b.png）',
    })
  })

  it('全部失敗したら失敗した名前を残す', () => {
    expect(summarizeBulkDeleteResult(0, ['a.png'])).toEqual({
      tone: 'error',
      message: '削除できませんでした（a.png）',
    })
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
