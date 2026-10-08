import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canEditDashboardLayout, greeting, headline } from './dashboard'
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

  it('はじめにやることはオーナー・管理者だけ、全部済んだら出さない（畳んでいても出す）', () => {
    const some = summarizeFirstSteps({ connect: true, greeting: false, richMenu: false, broadcast: false, scenario: false, invite: false })
    const all = summarizeFirstSteps({ connect: true, greeting: true, richMenu: true, broadcast: true, scenario: true, invite: true })
    expect(shouldShowFirstSteps('owner', some)).toBe(true)
    expect(shouldShowFirstSteps('admin', some)).toBe(true)
    expect(shouldShowFirstSteps('staff', some)).toBe(false)
    expect(shouldShowFirstSteps('viewer', some)).toBe(false)
    expect(shouldShowFirstSteps(null, some)).toBe(false)
    expect(shouldShowFirstSteps('owner', all)).toBe(false)
    expect(shouldShowFirstSteps('owner', null)).toBe(false)
  })

  it('グラフの日付は暦の曜日つき、見出しの脇は期間の両端', () => {
    expect(trendDay('2026-09-24')).toEqual({ md: '9/24', jp: '9月24日', week: '木' })
    expect(trendDay('2026-09-30').week).toBe('水')
    const day = (date: string) => ({ date, added: 0, blocked: 0, active: 0, estimated: false })
    expect(trendRangeNote([day('2026-09-24'), day('2026-09-30')])).toBe('直近7日（9月24日〜9月30日）')
    expect(trendRangeNote([])).toBe('直近7日')
  })
})

/*
 * ダッシュボード編集の入口（2026-10-08 司令塔・確認表 B-42）：隠すのは閲覧のみ（role 'viewer'＝
 * 読み取り専用でサーバーが保存を断る人）だけ。書き込みできるスタッフは自分の並びを編集できる。
 */
describe('ダッシュボード編集の入口', () => {
  it('スタッフ・管理者・オーナーには出す。閲覧のみには出さない。役割を読む前は出す', () => {
    expect(canEditDashboardLayout('staff')).toBe(true)
    expect(canEditDashboardLayout('admin')).toBe(true)
    expect(canEditDashboardLayout('owner')).toBe(true)
    expect(canEditDashboardLayout(null)).toBe(true)
    expect(canEditDashboardLayout('viewer')).toBe(false)
  })

  it('板の頭のボタン・数のマスの「…」・?edit=1 の窓の3か所とも同じ判定で出し入れする（配信を作るの判定と混ぜない）', () => {
    const src = readFileSync(join(__dirname, 'dashboard.tsx'), 'utf8')
    expect(src).toMatch(/\.\.\.\(canEditLayout \? \[\{ id: 'edit', label: 'ダッシュボード編集'/)
    expect(src).toMatch(/\{canEditLayout \? <Button type="button" onClick=\{d\.openEditor\}>/)
    expect(src).toMatch(/overlays=\{d\.editorOpen && canEditLayout \? <DashboardEditor/)
    expect(src.match(/onClick=\{d\.openEditor\}|onSelect: d\.openEditor/g)).toHaveLength(2)
  })
})
