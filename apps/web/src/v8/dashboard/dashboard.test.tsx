import { describe, expect, it } from 'vitest'
import { greeting, headline } from './dashboard'
import { FIRST_STEPS, shouldShowFirstSteps, summarizeFirstSteps, type FirstStepFacts } from './first-steps'
import { trendDay, trendRangeNote } from './trend'

/*
 * ★V8 ダッシュボード（WQmep）の言葉の組み立て。
 * 絵の文字（あいさつ・更新の行・はじめにやること・グラフの日付）がデータから
 * どう出るかを見張る。
 */
describe('V8 ダッシュボードの言葉', () => {
  it('あいさつは日本時間の時間帯と名前の最初の語で作る', () => {
    expect(greeting('Kenta Kawano', new Date('2026-01-13T00:30:00Z'))).toBe('おはようございます、Kenta さん')
    expect(greeting('Kenta Kawano', new Date('2026-01-13T03:00:00Z'))).toBe('こんにちは、Kenta さん')
    expect(greeting('Kenta Kawano', new Date('2026-01-13T12:00:00Z'))).toBe('こんばんは、Kenta さん')
    expect(greeting(null, new Date('2026-01-13T00:30:00Z'))).toBe('おはようございます')
  })

  it('更新の行は「更新 日付時刻 ・ 動きの状態」。時刻が無ければ状態だけ', () => {
    expect(headline('2026-01-13 09:30:00', 'normal')).toMatch(/^更新 (1月13日（火）)?9:30 ・ 正常に動いています$/)
    expect(headline(null, 'danger')).toBe('止まっているところがあります')
    expect(headline(undefined, null)).toBe('動きを確かめています')
  })

  it('はじめにやることは6つの判定を数える。1つでも判定できなければ出さない', () => {
    const facts: FirstStepFacts = { connect: true, greeting: true, richMenu: true, broadcast: false, scenario: false, invite: false }
    const summary = summarizeFirstSteps(facts)
    expect(summary).toMatchObject({ done: 3, total: 6 })
    expect(summary?.steps.map((step) => step.label)).toEqual(FIRST_STEPS.map((step) => step.label))
    expect(summary?.steps.filter((step) => !step.done).map((step) => step.link)).toEqual(['作る →', '作る →', '招待する →'])
    expect(summarizeFirstSteps({ ...facts, richMenu: null })).toBeNull()
  })

  it('はじめにやることはオーナー・管理者だけ、閉じたら・全部済んだら出さない', () => {
    const some = summarizeFirstSteps({ connect: true, greeting: false, richMenu: false, broadcast: false, scenario: false, invite: false })
    const all = summarizeFirstSteps({ connect: true, greeting: true, richMenu: true, broadcast: true, scenario: true, invite: true })
    expect(shouldShowFirstSteps('owner', some, false)).toBe(true)
    expect(shouldShowFirstSteps('admin', some, false)).toBe(true)
    expect(shouldShowFirstSteps('staff', some, false)).toBe(false)
    expect(shouldShowFirstSteps('viewer', some, false)).toBe(false)
    expect(shouldShowFirstSteps(null, some, false)).toBe(false)
    expect(shouldShowFirstSteps('owner', some, true)).toBe(false)
    expect(shouldShowFirstSteps('owner', all, false)).toBe(false)
    expect(shouldShowFirstSteps('owner', null, false)).toBe(false)
  })

  it('グラフの日付は暦の曜日つき、見出しの脇は期間の両端', () => {
    expect(trendDay('2026-09-24')).toEqual({ md: '9/24', jp: '9月24日', week: '木' })
    expect(trendDay('2026-09-30').week).toBe('水')
    const day = (date: string) => ({ date, added: 0, blocked: 0, active: 0, estimated: false })
    expect(trendRangeNote([day('2026-09-24'), day('2026-09-30')])).toBe('直近7日（9月24日〜9月30日）')
    expect(trendRangeNote([])).toBe('直近7日')
  })
})
