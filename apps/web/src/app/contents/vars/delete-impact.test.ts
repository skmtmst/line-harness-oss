import { describe, expect, it } from 'vitest'
import {
  blockedReason,
  canDelete,
  checkedAtText,
  consequenceText,
  NOT_AVAILABLE,
  placeholderText,
  splitItems,
  unavailableText,
  usageText,
} from './delete-impact'

const impact = (over: Record<string, unknown> = {}) =>
  ({
    variable: { id: 'v1', name: '営業時間', varKey: 'shop_hours' },
    total: 3, blockingTotal: 2, historicalTotal: 1, unscopedFormTotal: 1,
    canDelete: false, byKind: {}, items: [], unavailableReferences: [],
    checkedAt: '2026-08-31T01:00:00.000Z', recommendedAction: 'review_references',
    ...over,
  }) as never

describe('差し込みキー', () => {
  it('一覧と同じ形で出す', () => {
    /*
     * 一覧は `{{var.shop_hours}}` と出している。確認だけ `{shop_hours}` に
     * すると、どちらを打てばよいのか分からない。
     */
    expect(placeholderText('shop_hours')).toBe('{{var.shop_hours}}')
  })
})

describe('使われている数', () => {
  it('0か所を未取得と混ぜない', () => {
    expect(usageText(impact({ total: 0 }))).toBe('どこにも差し込まれていません。')
  })

  it('件数と差し込みキーを一緒に出す', () => {
    expect(usageText(impact())).toContain('{{var.shop_hours}} は 3か所で差し込まれています')
  })
})

describe('消したときに起きること', () => {
  it('「消えます」ではなく「空欄のまま送られます」と言う', () => {
    /*
     * 差し込みが消えても文そのものは送られ続ける。
     * 「消えます」だと、その文ごと止まると読める。
     */
    const text = consequenceText(impact())
    expect(text).toContain('空欄のまま送られます')
    expect(text).not.toContain('消えます')
  })

  it('どこにも使われていなければ何も言わない', () => {
    expect(consequenceText(impact({ total: 0 }))).toBeNull()
  })
})

describe('使用先の分け方', () => {
  it('送信済みを消せない理由に混ぜない', () => {
    /*
     * もう送ったものは、これから変わることが無い。
     * 同じ一覧に混ぜると「なぜ消せないのか」が読めなくなる。
     */
    const { blocking, historical } = splitItems([
      { blocksDeletion: true, name: 'A' } as never,
      { blocksDeletion: false, name: 'B' } as never,
    ])
    expect(blocking.map((i) => i.name)).toEqual(['A'])
    expect(historical.map((i) => i.name)).toEqual(['B'])
  })
})

describe('見せられない使用先', () => {
  it('件数を隠さず、名前だけ出せないと言う', () => {
    const text = unavailableText(impact({
      unavailableReferences: [{ kind: 'form', kindLabel: '回答フォーム', count: 1, reason: '所属を確認できないため' }],
    }))
    expect(text).toContain('回答フォーム1件')
    expect(text).toContain('所属を確認できないため')
  })

  it('無ければ何も言わない', () => {
    expect(unavailableText(impact())).toBeNull()
  })
})

describe('消してよいか', () => {
  it('差し込みキーを打つまで押せない', () => {
    /*
     * 空欄のまま送られる場所がある操作を、ボタン1つで通さない。
     * 取り消せないので、対象を取り違えたまま押せる形にしない。
     */
    const ok = impact({ canDelete: true, total: 0, blockingTotal: 0 })
    expect(canDelete({ impact: ok, typedKey: '', busy: false })).toBe(false)
    expect(canDelete({ impact: ok, typedKey: '{{var.shop_hours}}', busy: false })).toBe(true)
    expect(canDelete({ impact: ok, typedKey: ' {{var.shop_hours}} ', busy: false })).toBe(true)
    expect(canDelete({ impact: ok, typedKey: '{shop_hours}', busy: false })).toBe(false)
  })

  it('使われているあいだは、キーを打っても押せない', () => {
    expect(canDelete({ impact: impact(), typedKey: '{{var.shop_hours}}', busy: false })).toBe(false)
  })

  it('読み込めていないときと送信中は押せない', () => {
    expect(canDelete({ impact: null, typedKey: '{{var.shop_hours}}', busy: false })).toBe(false)
    expect(canDelete({ impact: impact({ canDelete: true }), typedKey: '{{var.shop_hours}}', busy: true })).toBe(false)
  })
})

describe('押せない理由', () => {
  it('使われている数を言う', () => {
    expect(blockedReason({ impact: impact(), typedKey: '' })).toContain('2か所で使われているあいだは')
  })

  it('キーが未入力なら、そのことを言う', () => {
    expect(blockedReason({ impact: impact({ canDelete: true }), typedKey: '' }))
      .toContain('{{var.shop_hours}} を入力してください')
  })

  it('押せるときは理由を出さない', () => {
    expect(blockedReason({ impact: impact({ canDelete: true }), typedKey: '{{var.shop_hours}}' })).toBeNull()
  })

  it('内部の記号を出さない', () => {
    for (const t of [blockedReason({ impact: null, typedKey: '' }), blockedReason({ impact: impact(), typedKey: '' })]) {
      expect(t ?? '').not.toMatch(/[a-z_]{4,}\b(?![}])/)
    }
  })
})

describe('確かめた時刻', () => {
  it('読めなければ「—（未取得）」', () => {
    expect(checkedAtText('こわれた日付')).toBe(NOT_AVAILABLE)
  })
})
