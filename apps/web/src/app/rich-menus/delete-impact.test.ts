import { describe, expect, it } from 'vitest'
import {
  audienceReason,
  audienceText,
  blockerTexts,
  canDelete,
  nextDisplayText,
  NOT_AVAILABLE,
  recommendedActionText,
  referenceKindText,
} from './delete-impact'

describe('表示中の人数', () => {
  it('未取得を0人にしない', () => {
    /*
     * 誰に出ているかの記録がまだ無いだけで、0人ではない。
     * 0人と書くと「消しても誰にも影響しない」と読める。
     */
    expect(audienceText({ value: null, reason: 'assignment_ledger_unavailable' })).toBe(NOT_AVAILABLE)
    expect(audienceReason({ value: null, reason: 'assignment_ledger_unavailable' }))
      .toContain('記録がまだ無い')
  })

  it('取得できた0は0人と書く', () => {
    expect(audienceText({ value: 0, reason: 'assignment_ledger_unavailable' })).toBe('0人')
    expect(audienceReason({ value: 0, reason: 'assignment_ledger_unavailable' })).toBeNull()
  })

  it('実値はそのまま出す', () => {
    expect(audienceText({ value: 1842, reason: 'assignment_ledger_unavailable' })).toBe('1,842人')
  })
})

describe('次に出るメニュー', () => {
  it('「必ずこれが出る」と言わない', () => {
    // 友だちごとの条件で決まるので、契約も guaranteedGroupId: null を返す。
    const text = nextDisplayText({
      guaranteedGroupId: null,
      reason: 'friend_specific_rules',
      candidates: [
        { groupId: 'g1', name: '通常メニュー', targetingPriority: 20, isTargetingEnabled: false, isDefaultForAll: true },
      ],
    })
    expect(text).toContain('友だちごとの条件で決まります')
    expect(text).toContain('通常メニュー')
    expect(text).not.toContain('必ず')
  })

  it('候補が無いときは、出なくなる友だちがいると言う', () => {
    const text = nextDisplayText({ guaranteedGroupId: null, reason: 'friend_specific_rules', candidates: [] })
    expect(text).toContain('出なくなる友だちがいます')
  })
})

describe('消せない理由', () => {
  it('内部の記号をそのまま出さない', () => {
    const texts = blockerTexts(['published', 'incoming_switches', 'operational_references'])
    for (const t of texts) expect(t).not.toMatch(/[a-z_]{4,}/)
    expect(texts[0]).toContain('先に取り下げてください')
  })

  it('何をすればよいかを言う', () => {
    expect(recommendedActionText('unpublish')).toContain('取り下げ')
    expect(recommendedActionText('review_references')).toContain('外して')
    expect(recommendedActionText('delete')).toBe('消せます。')
  })

  it('参照元の種類を日本語で言う', () => {
    expect(referenceKindText('automation')).toBe('オートメーション')
    expect(referenceKindText('common_action')).toBe('共通アクション')
  })
})

describe('消してよいか', () => {
  const impact = (over: Record<string, unknown> = {}) =>
    ({ canDelete: true, blockers: [], ...over }) as never

  it('canDelete と blockers の両方を見る', () => {
    /*
     * どちらか一方だけだと、片方が更新されたときに押せてしまう
     * 組み合わせが残る。
     */
    expect(canDelete({ impact: impact(), busy: false })).toBe(true)
    expect(canDelete({ impact: impact({ canDelete: false }), busy: false })).toBe(false)
    expect(canDelete({ impact: impact({ blockers: ['published'] }), busy: false })).toBe(false)
  })

  it('読み込めていないときと送信中は押せない', () => {
    expect(canDelete({ impact: null, busy: false })).toBe(false)
    expect(canDelete({ impact: impact(), busy: true })).toBe(false)
  })
})
