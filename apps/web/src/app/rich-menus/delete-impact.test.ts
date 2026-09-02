import { describe, expect, it } from 'vitest'
import {
  audienceReason,
  impactFromError,
  impactMatchesRequest,
  audienceText,
  blockerTexts,
  canDelete,
  nextDisplayText,
  NOT_AVAILABLE,
  recommendedActionText,
  referenceKindText,
  sameDeleteImpactRequest,
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

describe('409に入っている最新の影響', () => {
  const valid = {
    group: { id: 'g', accountId: 'a', name: 'n', status: 'draft' },
    currentAudience: { value: null, reason: 'assignment_ledger_unavailable' },
    nextDisplay: { guaranteedGroupId: null, reason: 'friend_specific_rules', candidates: [] },
    incomingSwitches: [], operationalReferences: [],
    lineResources: { pageCount: 0, pagesWithLineRichMenuId: 0, isDefaultForAll: false, publishing: false },
    blockers: ['incoming_switches'], canDelete: false, recommendedAction: 'review_references',
  }

  it('器に入っていても中身を取り出す', () => {
    // Workerは `{ success:false, error, data }` の形で返す。
    expect(impactFromError({ success: false, error: '使用中', data: valid })).not.toBeNull()
    expect(impactFromError(valid)).not.toBeNull()
  })

  it('形が違うものを素通ししない', () => {
    /*
     * `unknown` をそのまま入れると、次の描画で落ちる。
     * 古い「消せます」を残すより落ちるほうが悪い。
     */
    for (const bad of [null, undefined, 'x', 42, {}, { canDelete: true }, { ...valid, blockers: 'x' }]) {
      expect(impactFromError(bad)).toBeNull()
    }
  })

  it('アカウントとメニューの両方が合う影響だけを受け取る', () => {
    const request = { accountId: 'a', groupId: 'g', generation: 4 }
    expect(impactMatchesRequest(valid as never, request)).toBe(true)
    expect(impactMatchesRequest({ ...valid, group: { ...valid.group, accountId: 'other' } } as never, request))
      .toBe(false)
    expect(impactMatchesRequest({ ...valid, group: { ...valid.group, id: 'other' } } as never, request))
      .toBe(false)
  })
})

describe('遅い応答の照合', () => {
  const request = { accountId: 'account-1', groupId: 'group-1', generation: 3 }

  it('同じ対象でも前の読み込み世代は捨てる', () => {
    expect(sameDeleteImpactRequest(request, request)).toBe(true)
    expect(sameDeleteImpactRequest({ ...request, generation: 2 }, request)).toBe(false)
  })

  it('別アカウントと別メニューの応答を捨てる', () => {
    expect(sameDeleteImpactRequest({ ...request, accountId: 'account-2' }, request)).toBe(false)
    expect(sameDeleteImpactRequest({ ...request, groupId: 'group-2' }, request)).toBe(false)
    expect(sameDeleteImpactRequest(null, request)).toBe(false)
  })
})
