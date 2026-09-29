import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 追加監査（ANALYTICS-04/05/06・CONVERSION-05）の契約試験。
 *
 * - 未取得・失敗のファネル結果で人数・割合を出さない
 * - 「まだ途中の人」を「止まった人」に混ぜない
 * - 集計状態と定義版の新旧を別の軸として出す
 * - 成果地点への利用先記録の失敗を静かに成功に見せない
 */
const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')
const WORKER = readFileSync(
  new URL('../../../../worker/src/routes/analytics.ts', import.meta.url),
  'utf8',
)
const CONVERSION_DB = readFileSync(
  new URL('../../../../../packages/db/src/conversion-definitions.ts', import.meta.url),
  'utf8',
)
const SAVED_DB = readFileSync(
  new URL('../../../../../packages/db/src/analytics-saved.ts', import.meta.url),
  'utf8',
)

describe('ANALYTICS-04: 未取得・失敗のファネルで数字を出さない', () => {
  it('集計状態で出し分ける', () => {
    // 数値を出す口は available/partial のときだけ。
    expect(PAGE).toContain("run.state === 'available' || run.state === 'partial'")
    expect(PAGE).toContain('const measurable =')
  })

  it('判定不能は数値ではなく「判定不能」と理由を出す', () => {
    expect(PAGE).toContain('判定不能です。人数や割合は実測値ではありません')
    // KPIカードも判定不能を書く
    expect(PAGE.match(/'判定不能'/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // 一部取得は断りを添える
    expect(PAGE).toContain("run.state === 'partial'")
  })

  it('「まだ途中の人」を「止まった人」に混ぜない', () => {
    // 前段到達−今段到達ではなく、口が数えた droppedAfter を使う
    expect(PAGE).toContain('prev.droppedAfter')
    expect(PAGE).toContain('prev?.inProgressAfter')
    expect(PAGE).not.toContain('prev - result[i].reached')
    expect(PAGE).toContain('人はまだ途中です')
  })

  it('判定不能では対象者を選べない', () => {
    expect(PAGE).toContain('if (!measurable) return')
    expect(PAGE).toContain('この結果は判定不能のため、対象者は選べません')
  })

  it('CSVも状態と定義版を先に書き、判定不能の数値列は出さない', () => {
    expect(PAGE).toContain("['集計状態'")
    expect(PAGE).toContain("['集計した定義版'")
    expect(PAGE).toContain('measurable ? [')
  })
})

describe('ANALYTICS-05: 未取得・失敗を「定義が古い」と分類しない', () => {
  it('「定義が古い」は版ずれだけを数える', () => {
    expect(PAGE).toContain('item.latestSnapshot?.definitionStale')
    // 取得状態で定義の新旧を決めない
    expect(PAGE).not.toContain(
      "['unavailable', 'failed'].includes(item.latestSnapshot.state)",
    )
    expect(PAGE).toContain('いまの定義でまだ集計していないもの')
  })

  it('行ごとに集計状態と版ずれを分けて出す', () => {
    expect(PAGE).toContain('更新後未集計')
    expect(PAGE).toContain('SAVED_STATE_TONES[item.latestSnapshot.state]')
  })

  it('台帳は写しの版と元の定義のいまの版を返す', () => {
    expect(SAVED_DB).toContain('snapshot_source_version')
    expect(SAVED_DB).toContain('source_current_version')
    expect(SAVED_DB).toContain('definitionStale')
    expect(API).toContain('sourceVersionNumber: number | null')
    expect(API).toContain('sourceCurrentVersionNumber: number | null')
  })
})

describe('ANALYTICS-06: いまの定義版と集計結果の版を分けて出す', () => {
  it('結果がどの定義版で集計されたかを書く', () => {
    expect(PAGE).toContain('集計した定義版 ${run.versionNumber}')
    expect(API).toContain('versionNumber: number | null')
  })

  it('ずれているとき旧版の結果だと断り、再集計へ誘導する', () => {
    expect(PAGE).toContain('run.versionNumber !== selectedFunnel.currentVersion.versionNumber')
    expect(PAGE).toContain('この結果は定義版')
    expect(PAGE).toContain('いまの定義は版')
  })
})

describe('CONVERSION-05: 段の成果地点への利用先記録は確実に行い、失敗を知らせる', () => {
  it('下書き・停止中の地点にも利用関係を記す', () => {
    expect(WORKER).toContain('allowInactive: true')
    expect(CONVERSION_DB).toContain('allowInactive?: boolean')
    // 手追加の口は止めたまま
    expect(CONVERSION_DB).toContain("point.status !== 'active' && !input.allowInactive")
  })

  it('記録に失敗した地点は応答へ載せ、画面が断りを出す', () => {
    expect(WORKER).toContain('usageWarnings')
    expect(WORKER).toContain('const usageWarnings = await registerFunnelConversionUsages')
    expect(PAGE).toContain('usageWarnings')
    expect(PAGE).toContain('利用先記録に失敗しました')
    expect(API).toContain('usageWarnings?: string[]')
  })
})
