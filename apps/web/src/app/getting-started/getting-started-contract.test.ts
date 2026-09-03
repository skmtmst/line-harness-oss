import { describe, expect, it } from 'vitest'
import type { FriendAddRouting, FriendAddRoutingVersion, LineAccount, Scenario } from '@line-crm/shared'
import {
  CARE_ITEMS,
  FEATURE_LINKS,
  STEP_STATE_LABEL,
  type GettingStartedInput,
  buildSteps,
  doneCount,
  allDone,
  progressHeadline,
  stoppedReasons,
} from './getting-started-view'

/**
 * 設計 ★V6 34-1「はじめの設定」（`RAW35`）の判定を、文言ごと固定する。
 *
 * ここで守りたいのは 1 点——**「画面を開いた」を「終わった」に読み替えない**こと。
 * 判定はすべて実物から計算する。
 */

function account(over: Partial<LineAccount> = {}): LineAccount {
  return {
    id: 'a1',
    channelId: '1',
    name: '然-NEN- TEST',
    loginChannelId: null,
    liffId: null,
    isActive: true,
    channelSecretConfigured: true,
    webhook: { status: 'matched' },
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  } as LineAccount
}

function routing(over: Partial<FriendAddRouting> = {}): FriendAddRouting {
  return {
    firstTime: { scenarioId: null, actions: [], timing: 'immediate' },
    returning: { scenarioId: null, actions: [], mode: 'none', startPosition: 'start' },
    criteria: { firstTime: 'never_added' },
    ...over,
  } as FriendAddRouting
}

function version(over: Partial<FriendAddRoutingVersion> = {}): FriendAddRoutingVersion {
  return {
    accountId: 'a1',
    versionId: 'v1',
    versionNumber: 1,
    status: 'draft',
    routing: routing(),
    lastTestStatus: null,
    lastTestedAt: null,
    publishedAt: null,
    ...over,
  }
}

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: 's1',
    name: '新規登録 7日間フォロー',
    description: null,
    triggerType: 'tag_added',
    triggerTagId: null,
    lineAccountId: null,
    isActive: true,
    ...over,
  } as Scenario
}

const EMPTY: GettingStartedInput = {
  accounts: [],
  tagCount: 0,
  friendFieldCount: 0,
  friendAdd: null,
  friendAddDraft: null,
  scenarios: [],
  role: 'owner',
}

describe('段は5つで、順番と題が設計どおり', () => {
  it('題と丸の文字が設計 RAW35 と一致する', () => {
    const steps = buildSteps(EMPTY)
    expect(steps.map((s) => [s.ordinal, s.title])).toEqual([
      ['1', 'LINEアカウントをつなぐ'],
      ['2', '友だちの分け方を決める'],
      ['3', '友だち追加時の配信を作る'],
      ['4', 'シナリオを作る'],
      ['最終', '最初の1通を受け取る'],
    ])
  })

  it('どの段でも「終わったと見なす条件」を必ず出す', () => {
    for (const step of buildSteps(EMPTY)) {
      expect(step.condition.length).toBeGreaterThan(0)
      expect(step.next.length).toBeGreaterThan(0)
    }
  })
})

describe('段1 LINEアカウント', () => {
  it('稼働・一致・シークレット確認の3つが揃って初めて終わり', () => {
    expect(buildSteps({ ...EMPTY, accounts: [account()] })[0].state).toBe('done')
  })

  it('まだ確かめていない Webhook を「合っている」と読まない', () => {
    const steps = buildSteps({ ...EMPTY, accounts: [account({ webhook: { status: 'unknown' } })] })
    expect(steps[0].state).toBe('stalled')
  })

  it('シークレットが未確認なら終わりにしない', () => {
    const steps = buildSteps({ ...EMPTY, accounts: [account({ channelSecretConfigured: false })] })
    expect(steps[0].state).toBe('stalled')
  })

  it('1件も無ければ「まだです」', () => {
    expect(buildSteps(EMPTY)[0].state).toBe('todo')
  })
})

describe('段2 友だちの分け方', () => {
  it('タグだけでも友だち情報欄だけでも終わり', () => {
    expect(buildSteps({ ...EMPTY, tagCount: 1 })[1].state).toBe('done')
    expect(buildSteps({ ...EMPTY, friendFieldCount: 1 })[1].state).toBe('done')
  })
})

describe('段3 友だち追加時の配信', () => {
  it('下書きがあるだけでは終わらず「止まっています」', () => {
    const steps = buildSteps({
      ...EMPTY,
      friendAdd: { configured: true, routing: routing() },
      friendAddDraft: version(),
    })
    expect(steps[2].state).toBe('stalled')
    expect(steps[2].next).toContain('まだ公開していません')
  })

  it('公開されていれば終わり', () => {
    const steps = buildSteps({
      ...EMPTY,
      friendAdd: { configured: true, routing: routing() },
      friendAddDraft: version({ status: 'published', publishedAt: '2026-09-01T00:00:00Z' }),
    })
    expect(steps[2].state).toBe('done')
  })
})

describe('段4 シナリオ', () => {
  it('公開シナリオがあっても、段3のルールから始まらなければ終わらない', () => {
    const steps = buildSteps({ ...EMPTY, scenarios: [scenario()] })
    expect(steps[3].state).toBe('stalled')
  })

  it('段3のルールが指しているシナリオが動いていれば終わり', () => {
    const steps = buildSteps({
      ...EMPTY,
      friendAdd: {
        configured: true,
        routing: routing({ firstTime: { scenarioId: 's1', actions: [], timing: 'immediate' } as FriendAddRouting['firstTime'] }),
      },
      scenarios: [scenario()],
    })
    expect(steps[3].state).toBe('done')
  })

  /*
    実画面で落ちた形。`configured` だけ返って `routing` が来ないことがある。
    **型が言い切っていても、外から来た値は疑う。**
  */
  it('振り分けの中身が読めなくても落ちない', () => {
    const steps = buildSteps({ ...EMPTY, friendAdd: { configured: true }, scenarios: [scenario()] })
    expect(steps[3].state).toBe('stalled')
  })

  it('1本も無いときだけ「レシピから作る」へ誘う', () => {
    expect(buildSteps(EMPTY)[3].action).toEqual({ label: 'レシピから作る', href: '/recipes' })
  })
})

describe('最終確認 最初の1通', () => {
  /*
    **数を作らない。** 「1通目が届いたか」を返す口がまだ無いので、
    終わったことにも、まだですにもしない。確かめられないと言う。
  */
  it('数える口が無いので「確かめられません」で止める', () => {
    const steps = buildSteps(EMPTY)
    expect(steps[4].state).toBe('unknown')
    expect(steps[4].next).toContain('数える口がまだありません')
  })

  /*
    **読めないのと、無いのは違う。** 役割が引けなかったときに
    「権限がありません」と言うと、実際には進められる人を止めてしまう。
  */
  it('役割が読めなかったときを「権限がありません」と読まない', () => {
    const steps = buildSteps({ ...EMPTY, role: null })
    expect(steps[4].state).toBe('unknown')
    expect(steps[4].blockedReason).toBeNull()
  })

  it('閲覧者には権限で止まっていることを言い、ボタンを描かない', () => {
    const steps = buildSteps({ ...EMPTY, role: 'viewer' })
    expect(steps[4].state).toBe('forbidden')
    expect(steps[4].action).toBeNull()
    expect(steps[4].blockedReason).toBe('管理者に頼んでください')
  })
})

describe('見出しと止まっている理由', () => {
  it('数に単位を付け、次の段の題を出す', () => {
    const steps = buildSteps({ ...EMPTY, accounts: [account()], tagCount: 1 })
    expect(progressHeadline(steps)).toBe(
      'はじめの設定 2 / 5 が完了。次は「友だち追加時の配信を作る」です。',
    )
    expect(doneCount(steps)).toBe(2)
    expect(allDone(steps)).toBe(false)
  })

  it('確かめられない段を「終わった」に数えない', () => {
    const steps = buildSteps({
      ...EMPTY,
      accounts: [account()],
      tagCount: 1,
      friendAdd: { configured: true, routing: routing({ firstTime: { scenarioId: 's1', actions: [], timing: 'immediate' } as FriendAddRouting['firstTime'] }) },
      friendAddDraft: version({ status: 'published', publishedAt: '2026-09-01T00:00:00Z' }),
      scenarios: [scenario()],
    })
    expect(doneCount(steps)).toBe(4)
    expect(allDone(steps)).toBe(false)
  })

  it('止まっている段と、権限で進めない段を分けて言う', () => {
    const lines = stoppedReasons(buildSteps({ ...EMPTY, accounts: [account()], role: 'viewer' }))
    expect(lines.some((l) => l.startsWith('段2'))).toBe(false)
    expect(lines.some((l) => l.includes('管理者に頼んでください'))).toBe(true)
  })
})

describe('右カラム', () => {
  it('つながる先は要件 §5-2 の 5 つだけ', () => {
    expect(FEATURE_LINKS.map((l) => l.label)).toEqual([
      'LINEアカウント',
      '友だち属性',
      '友だち追加時の配信',
      'シナリオ配信',
      'ダッシュボード',
    ])
  })

  it('気をつけることは設計の 3 行', () => {
    expect(CARE_ITEMS).toHaveLength(3)
  })

  it('状態の呼び名を色に頼らず文字で持つ', () => {
    expect(Object.values(STEP_STATE_LABEL)).toContain('終わりました')
    expect(Object.values(STEP_STATE_LABEL)).toContain('止まっています')
    expect(Object.values(STEP_STATE_LABEL)).toContain('まだです')
  })
})
