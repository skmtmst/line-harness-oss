import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * ★V8 シナリオ配信の編集・配信結果の契約（#1161）。
 *
 * 文字の契約ではなく「Pencil の板と受け口が繋がっているか」の契約。
 * - detail-v8.tsx … `PMLkX`（有効）/ `nMSiE`（始めた直後）/ `ARuZ4`（停止中）、
 *   小窓 `F1LK4e`（開始の確認）・`OPGU2`（停止の確認）・`Al4Ek`（複製）
 * - results-v8.tsx … `X4STXS`（配信結果）
 * - page.tsx 2 つ … 現役 V8 に固定
 *
 * 動きの契約（API・確認キー・購読操作）はここに固定する。
 * 板の文言の一字一句は固定しない（V8 の直しで文言が変わるたびに
 * 試験を書き換えることになるため）。
 */

const V8_DETAIL = fs.readFileSync(path.join(__dirname, '../../../v8/scenario-detail/detail.tsx'), 'utf8')
const V8_DETAIL_PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const V8_DETAIL_CSS = fs.readFileSync(path.join(__dirname, '../../../v8/scenario-detail/detail.module.css'), 'utf8')
const RESULTS_CURRENT = fs.readFileSync(new URL('../../../v8/scenarios/results.tsx', import.meta.url), 'utf8')
const V8_RESULTS = fs.readFileSync(
  path.join(__dirname, '../../../v8/scenarios/results.tsx'),
  'utf8',
)
const V8_RESULTS_PAGE = fs.readFileSync(new URL('../../../v8/scenarios/results.tsx', import.meta.url), 'utf8')
const V8_RESULTS_CSS = fs.readFileSync(
  path.join(__dirname, '../../../v8/scenarios/results.module.css'),
  'utf8',
)

describe('★V8 シナリオ編集（PMLkX / nMSiE / ARuZ4）の契約', () => {

  it('上の3つの箱（保存・開始のきっかけ・配信）を持つ', () => {
    for (const label of ['保存', '開始のきっかけ', '配信']) {
      expect(V8_DETAIL).toContain(`<span className={styles.stageTitle}>${label}</span>`)
    }
  })

  it('数の帯と「最後の1通の後」の行を持つ', () => {
    for (const label of ['購読中', '読み終えた', '始まる見込み（試算）', '離脱が多い所']) {
      expect(V8_DETAIL).toContain(`title="${label}"`)
    }
    // ON_COMPLETE_LABEL の実設定から読む（固定文を置かない）。
    expect(V8_DETAIL).toContain('ON_COMPLETE_LABEL[')
  })

  it('メッセージの行カード・ここに挿入・右の欄のスマホを持つ', () => {
    // 右の欄は選んだ通の LINE プレビュー（共通部品）。
    expect(V8_DETAIL).toContain('<LinePreview')
  })

  it('通ごとの数（配信対象・届いた数・配信後）を持つ', () => {
    expect(V8_DETAIL).toContain('describeStepAudience(step.targetCondition, tags)')
    expect(V8_DETAIL).toContain('describeAfterSend(step.afterSend)')
    expect(V8_DETAIL).toContain('scenarioReachPercent(')
  })

  it('開始・停止は既存の isActive の口だけを使う', () => {
    expect(V8_DETAIL).toContain('api.scenarios.update(id, { isActive: true })')
    expect(V8_DETAIL).toContain('api.scenarios.update(id, { isActive: false })')
  })

  it('開始前の確認（F1LK4e）は試算が読めるまで確定できない', () => {
    // 人数が読めていないのに「確認しました」と押せる作りにしない（SCENARIO-07）。
    expect(V8_DETAIL).toContain('onConfirm={preflightLoading || preflightFailed ? undefined')
    expect(V8_DETAIL).toContain('startChecklist(')
  })

  it('止める確認（OPGU2）で保存先の無い「止める理由」の入力欄は出さない', () => {
    /*
     * 板には「止める理由（任意）」の欄があるが、API に受け口が無く、
     * 入力しても消えるだけになるので置いていない
     * （design/v8/DEVIN-QUESTIONS.md 参照）。口ができたら足す。
     */
    expect(V8_DETAIL).not.toContain('stopReason')
  })

  it('複製の小窓（Al4Ek）は既存の複製の動きに繋がっている', () => {
    expect(V8_DETAIL).toContain('void handleDuplicate(duplicateName)')
    // SCENARIO-09: 途中で止まった複製は残っていることを隠さない。
    expect(V8_DETAIL).toContain('duplicateRemainder')
  })

  it('始めた直後の知らせ（nMSiE）と結果への行き先を持つ', () => {
    expect(V8_DETAIL).toContain('startedBand')
  })

  it('閲覧のみの人は直す操作が押せない', () => {
    expect(V8_DETAIL).toContain("useFeatureAccess('scenarios')")
    expect(V8_DETAIL).toContain('readonlyReason')
  })
})

describe('★V8 シナリオ配信結果（X4STXS）の契約', () => {

  it('板の印（X4STXS）と数の帯を持つ', () => {
    for (const label of ['始まった', '読み終えた', '途中', '離れた']) {
      expect(V8_RESULTS).toContain(`title="${label}"`)
    }
  })

  it('送れずに止まった・いま送っているの帯を持つ', () => {
    expect(V8_RESULTS).toContain('failedTotal')
    expect(V8_RESULTS).toContain('送れずに止まった人が')
    expect(V8_RESULTS).toContain('deliveringCount')
    expect(V8_RESULTS).toContain('いま送っています')
  })

  it('購読操作（止める・再開・失敗を再送・移す）は既存の口を使う', () => {
    expect(V8_RESULTS).toContain('api.scenarios.subscriptionOps[op]')
    expect(V8_RESULTS).toContain('api.scenarios.subscriptionOps.move')
    // 確認キー（Idempotency-Key）は購読ごとの署名で持つ。
    expect(V8_RESULTS).toContain('IdempotencyKeyStore')
    // pauseReason で「再開」と「失敗を再送」を出し分ける。
    expect(V8_RESULTS).toContain("sub.pauseReason === 'delivery_failed'")
  })

  it('取得失敗・未取得・0件を分けて出す（SCENARIO-10）', () => {
    expect(V8_RESULTS).toContain("runsState === 'idle'")
    expect(V8_RESULTS).toContain("runsState === 'loading'")
    expect(V8_RESULTS).toContain("runsState === 'error'")
  })
})

describe('★V8 シナリオの CSS モジュールの契約', () => {
  it('現役CSSは画面の寸法を共通のトークンから読む', () => {
    expect(V8_DETAIL_CSS).toContain('var(--tpl-sd-')
    expect(V8_RESULTS_CSS).toContain('var(--tpl-sc2-')
  })

  it('v7 に効かせる指定を持たない（data-theme セレクタの直書きは無い）', () => {
    /*
     * V8 の画面は component 側の分岐でだけ出るので、CSS 側で
     * [data-theme] を条件にする必要は無い。付いていたら v7 の
     * 見た目へ漏れ出す危険があるので契約で止める。
     */
    expect(V8_DETAIL_CSS.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('[data-theme')
    expect(V8_RESULTS_CSS).not.toContain('[data-theme')
  })
  it('通ごとの結果と友だちごとの記録を持つ', () => {
    expect(RESULTS_CURRENT).toContain('通ごとの反応')
    expect(RESULTS_CURRENT).toContain('参加中の友だち')
    expect(RESULTS_CURRENT).toContain('予定を見る')
    expect(RESULTS_CURRENT).toContain('さらに読み込む')
  })

})
