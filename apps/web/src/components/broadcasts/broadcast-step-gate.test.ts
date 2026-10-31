import { describe, expect, it } from 'vitest'
import {
  QUOTA_SHORT_MESSAGE,
  SCHEDULE_PAST_MESSAGE,
  broadcastNextBlockReason,
  broadcastSaveProblem,
  broadcastSaveProblemStep,
  broadcastStepPassed,
  broadcastStepProblems,
  type BroadcastStepCheckInput,
} from './broadcast-step-gate'

const NOW = Date.parse('2026-10-25T03:00:00.000Z')

/** どの段も通る入力。1か所ずつ崩して確かめる。 */
function input(overrides: Partial<BroadcastStepCheckInput> = {}): BroadcastStepCheckInput {
  return {
    title: '8月キャンペーンのお知らせ',
    titleMax: 60,
    audienceProblem: '',
    bubbleProblem: '',
    buttonProblem: '',
    lengthProblem: null,
    sendMode: 'now',
    scheduledDate: '',
    scheduledTime: '10:00',
    scheduledAt: null,
    now: NOW,
    quotaInsufficient: false,
    stepped: true,
    ...overrides,
  }
}

describe('一斉配信の段ごとの確かめ', () => {
  it('全部そろっていれば、どの段も通り、保存の検査も通る', () => {
    const problems = broadcastStepProblems(input())
    for (const step of ['basic', 'audience', 'message', 'schedule'] as const) {
      expect(broadcastStepPassed(problems, step)).toBe(true)
      expect(broadcastNextBlockReason(problems, step)).toBeNull()
    }
    expect(broadcastSaveProblem(problems)).toBe('')
  })

  it('配信名が空・長すぎるときは基本の段で止まる', () => {
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ title: '  ' })), 'basic')).toBe('配信名を入力してください')
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ title: 'あ'.repeat(61) })), 'basic')).toBe('配信名は60文字までにしてください')
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ title: 'あ'.repeat(60) })), 'basic')).toBeNull()
  })

  it('宛先の条件が決まっていないときは宛先の段で止まり、保存も止まる', () => {
    const problems = broadcastStepProblems(input({ audienceProblem: '配信対象のタグを選んでください' }))
    expect(broadcastNextBlockReason(problems, 'audience')).toBe('配信対象のタグを選んでください')
    expect(broadcastSaveProblem(problems)).toBe('配信対象のタグを選んでください')
  })

  it('吹き出し・ボタン・文字数の不備は中身の段で止まる', () => {
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ bubbleProblem: '吹き出し1の本文を入力してください' })), 'message')).toBe('吹き出し1の本文を入力してください')
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ buttonProblem: 'ボタン1の名前を入力してください' })), 'message')).toBe('ボタン1の名前を入力してください')
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ lengthProblem: '5,000文字を超えています' })), 'message')).toBe('5,000文字を超えています')
  })

  it('予約の日時が過ぎている・送信枠が足りないときは送信設定の段で止まる', () => {
    const past = broadcastStepProblems(input({ sendMode: 'scheduled', scheduledDate: '2026-10-24', scheduledTime: '12:00', scheduledAt: '2026-10-24T03:00:00.000Z' }))
    expect(broadcastNextBlockReason(past, 'schedule')).toBe(SCHEDULE_PAST_MESSAGE)
    const future = broadcastStepProblems(input({ sendMode: 'scheduled', scheduledDate: '2026-10-26', scheduledTime: '12:00', scheduledAt: '2026-10-26T03:00:00.000Z' }))
    expect(broadcastNextBlockReason(future, 'schedule')).toBeNull()
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ quotaInsufficient: true })), 'schedule')).toBe(QUOTA_SHORT_MESSAGE)
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ sendMode: 'scheduled', scheduledDate: '' })), 'schedule')).toBe('予約する日付と時刻を入力してください')
  })

  /*
   * 先へ進むのだけ止める不備は、下書きの保存を止めない（書きかけを残せる）。
   * 帯の ✓ は付かないが、保存は通る＝「帯は ✓ なのに保存で断られる」の逆は起きない。
   */
  it('文字数の超え・過ぎた日時・送信枠の不足では保存の検査を止めない', () => {
    const problems = broadcastStepProblems(input({
      lengthProblem: '5,000文字を超えています',
      sendMode: 'scheduled', scheduledDate: '2026-10-24', scheduledTime: '12:00', scheduledAt: '2026-10-24T03:00:00.000Z',
      quotaInsufficient: true,
    }))
    expect(broadcastStepPassed(problems, 'message')).toBe(false)
    expect(broadcastStepPassed(problems, 'schedule')).toBe(false)
    expect(broadcastSaveProblem(problems)).toBe('')
  })

  it('未選択・書きかけの予約日時・分数は先へ進めず、下書きには残せる', () => {
    const missing = { sendMode: 'scheduled' as const, scheduledDate: '' }
    expect(broadcastSaveProblem(broadcastStepProblems(input({ ...missing, stepped: true })))).toBe('')
    for (const timing of [{ sendMode: 'unselected' as const }, { spreadSelected: true, spreadMinutes: '' }, { spreadSelected: true, spreadMinutes: '721' }]) {
      const problems = broadcastStepProblems(input(timing))
      expect(broadcastNextBlockReason(problems, 'schedule')).toBeTruthy()
      expect(broadcastSaveProblem(problems)).toBe('')
    }
    expect(broadcastSaveProblem(broadcastStepProblems(input({ ...missing, stepped: false })))).toBe('')
  })

  /*
   * 帯の ✓・［次へ］・保存の検査が同じ結果を読んでいることを、食い違いやすい入力で見る。
   * 保存が断る段は、必ず帯でも ✓ が付かず［次へ］も止まる。
   */
  it('保存で断られる段は、帯の ✓ も［次へ］も通らない', () => {
    const cases: Array<Partial<BroadcastStepCheckInput>> = [
      { title: '' },
      { audienceProblem: '条件を決めてください' },
      { bubbleProblem: '本文を入力してください' },
      { buttonProblem: 'ボタンの行き先を入力してください' },
    ]
    for (const overrides of cases) {
      const problems = broadcastStepProblems(input(overrides))
      const step = broadcastSaveProblemStep(problems)
      expect(step, JSON.stringify(overrides)).not.toBeNull()
      if (!step) continue
      expect(broadcastStepPassed(problems, step)).toBe(false)
      expect(broadcastNextBlockReason(problems, step)).toBe(broadcastSaveProblem(problems))
    }
  })

  it('保存の検査は段の順で最初の不備を返す（今の検査と同じ順）', () => {
    const problems = broadcastStepProblems(input({ title: '', audienceProblem: '条件を決めてください', bubbleProblem: '本文を入力してください' }))
    expect(broadcastSaveProblem(problems)).toBe('配信名を入力してください')
    expect(broadcastSaveProblemStep(problems)).toBe('basic')
  })

  it('最終確認の段は［次へ］を持たない', () => {
    expect(broadcastNextBlockReason(broadcastStepProblems(input({ title: '' })), 'confirm')).toBeNull()
  })
})
