import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * ★V8 シナリオ配信の編集・配信結果の契約（#1161）。
 *
 * 文字の契約ではなく「Pencil の板と受け口が繋がっているか」の契約。
 * - detail-v8.tsx … `PMLkX`（稼働中）/ `nMSiE`（始めた直後）/ `ARuZ4`（停止中）、
 *   小窓 `F1LK4e`（開始の確認）・`OPGU2`（停止の確認）・`Al4Ek`（複製）
 * - results-v8.tsx … `X4STXS`（配信結果）
 * - page.tsx 2 つ … data-theme="v8" のときだけ V8 を描く
 *
 * 動きの契約（API・確認キー・購読操作）はここに固定する。
 * 板の文言の一字一句は固定しない（V8 の直しで文言が変わるたびに
 * 試験を書き換えることになるため）。
 */

const V8_DETAIL = fs.readFileSync(path.join(__dirname, 'detail-v8.tsx'), 'utf8')
const V8_DETAIL_PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const V8_DETAIL_CSS = fs.readFileSync(path.join(__dirname, 'detail-v8.module.css'), 'utf8')
const V8_RESULTS = fs.readFileSync(
  path.join(__dirname, '..', 'results', 'results-v8.tsx'),
  'utf8',
)
const V8_RESULTS_PAGE = fs.readFileSync(
  path.join(__dirname, '..', 'results', 'page.tsx'),
  'utf8',
)
const V8_RESULTS_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'results', 'results-v8.module.css'),
  'utf8',
)

describe('★V8 シナリオ編集（PMLkX / nMSiE / ARuZ4）の契約', () => {
  it('v7 とは別の部品として持ち、data-theme="v8" のときだけ出る', () => {
    expect(V8_DETAIL_PAGE).toContain("useAdminTheme")
    expect(V8_DETAIL_PAGE).toContain("theme === 'v8'")
    expect(V8_DETAIL_PAGE).toContain('<ScenarioDetailV8')
    // v7 の部品はそのまま残す（消すと v7 が表示できなくなる）。
    expect(V8_DETAIL_PAGE).toContain('<ScenarioDetailClient')
  })

  it('上の3つの箱（保存・開始のきっかけ・配信）を持つ', () => {
    for (const label of ['保存', '開始のきっかけ', '配信']) {
      expect(V8_DETAIL).toContain(`<span className={styles.stageTitle}>${label}</span>`)
    }
    // 箱のボタン：変更を保存 / きっかけを変える / 一時停止する・配信を再開する
    expect(V8_DETAIL).toContain('変更を保存')
    expect(V8_DETAIL).toContain('きっかけを変える')
    expect(V8_DETAIL).toContain('一時停止する')
    expect(V8_DETAIL).toContain('配信を再開する')
  })

  it('数の帯と「最後の1通の後」の行を持つ', () => {
    expect(V8_DETAIL).toContain('data-design="KPIs"')
    for (const label of ['予約中', '届いた', '送れなかった', '終わった']) {
      expect(V8_DETAIL).toContain(`<p className={styles.kpiLabel}>${label}</p>`)
    }
    expect(V8_DETAIL).toContain('最後の1通の後')
    // ON_COMPLETE_LABEL の実設定から読む（固定文を置かない）。
    expect(V8_DETAIL).toContain('ON_COMPLETE_LABEL[')
  })

  it('メッセージの行カード・ここに挿入・右の欄のスマホを持つ', () => {
    expect(V8_DETAIL).toContain('＋ ここに挿入')
    expect(V8_DETAIL).toContain('＋ メッセージを追加する')
    expect(V8_DETAIL).toContain('＋ テンプレートを追加する')
    expect(V8_DETAIL).toContain('＋ 分岐（質問）を追加する')
    // 右の欄は選んだ通の LINE プレビュー（共通部品）。
    expect(V8_DETAIL).toContain('<LinePreview')
    expect(V8_DETAIL).toContain('選んだ通（')
  })

  it('通ごとの数（配信対象・届いた数・配信後）を持つ', () => {
    expect(V8_DETAIL).toContain('通ごとの数')
    expect(V8_DETAIL).toContain('describeStepAudience(step.targetCondition, tags)')
    expect(V8_DETAIL).toContain('describeAfterSend(step.afterSend)')
    expect(V8_DETAIL).toContain('scenarioReachPercent(')
  })

  it('開始・停止は既存の isActive の口だけを使う', () => {
    expect(V8_DETAIL).toContain('api.scenarios.update(id, { isActive: true })')
    expect(V8_DETAIL).toContain('api.scenarios.update(id, { isActive: false })')
  })

  it('開始前の確認（F1LK4e）は試算が読めるまで確定できない', () => {
    expect(V8_DETAIL).toContain('designNode="F1LK4e"')
    // 人数が読めていないのに「確認しました」と押せる作りにしない（SCENARIO-07）。
    expect(V8_DETAIL).toContain('onConfirm={preflightLoading || preflightFailed ? undefined')
    expect(V8_DETAIL).toContain('startChecklist(')
    expect(V8_DETAIL).toContain('内容と対象を確かめました')
  })

  it('止める確認（OPGU2）で保存先の無い「止める理由」の入力欄は出さない', () => {
    expect(V8_DETAIL).toContain('designNode="OPGU2"')
    /*
     * 板には「止める理由（任意）」の欄があるが、API に受け口が無く、
     * 入力しても消えるだけになるので置いていない
     * （design/v8/DEVIN-QUESTIONS.md 参照）。口ができたら足す。
     */
    expect(V8_DETAIL).not.toContain('stopReason')
  })

  it('複製の小窓（Al4Ek）は既存の複製の動きに繋がっている', () => {
    expect(V8_DETAIL).toContain('designNode="Al4Ek"')
    expect(V8_DETAIL).toContain('void handleDuplicate(duplicateName)')
    // SCENARIO-09: 途中で止まった複製は残っていることを隠さない。
    expect(V8_DETAIL).toContain('duplicateRemainder')
    expect(V8_DETAIL).toContain('続きからやり直す')
  })

  it('始めた直後の知らせ（nMSiE）と結果への行き先を持つ', () => {
    expect(V8_DETAIL).toContain('配信を始めました')
    expect(V8_DETAIL).toContain('始めた記録を見る')
    expect(V8_DETAIL).toContain('startedBand')
  })

  it('閲覧のみの人は直す操作が押せない', () => {
    expect(V8_DETAIL).toContain('canManageRole(staffRole)')
    expect(V8_DETAIL).toContain('readonlyReason')
  })
})

describe('★V8 シナリオ配信結果（X4STXS）の契約', () => {
  it('v7 とは別の部品として持ち、data-theme="v8" のときだけ出る', () => {
    expect(V8_RESULTS_PAGE).toContain('useAdminTheme')
    expect(V8_RESULTS_PAGE).toContain("theme === 'v8'")
    expect(V8_RESULTS_PAGE).toContain('<ScenarioResultsV8 />')
    // v7 の本文はそのまま残す。
    expect(V8_RESULTS_PAGE).toContain('<ResultsInner />')
  })

  it('板の印（X4STXS）と数の帯を持つ', () => {
    expect(V8_RESULTS).toContain('data-design-node="X4STXS"')
    expect(V8_RESULTS).toContain('data-design="KPIs"')
    for (const label of ['届いた', '送れなかった', '進んでいる途中', '全部終わった']) {
      expect(V8_RESULTS).toContain(`<p className={styles.kpiLabel}>${label}</p>`)
    }
  })

  it('送れずに止まった・いま送っているの帯を持つ', () => {
    expect(V8_RESULTS).toContain('bandWarn')
    expect(V8_RESULTS).toContain('bandInfo')
    expect(V8_RESULTS).toContain('止まっている人だけを見る')
  })

  it('通ごとの結果と友だちごとの記録を持つ', () => {
    expect(V8_RESULTS).toContain('通ごとの結果')
    expect(V8_RESULTS).toContain('友だちごとの記録')
    expect(V8_RESULTS).toContain('予定を見る')
    expect(V8_RESULTS).toContain('さらに読み込む')
  })

  it('購読操作（止める・再開・失敗を再送・移す）は既存の口を使う', () => {
    expect(V8_RESULTS).toContain('api.scenarios.subscriptionOps[op]')
    expect(V8_RESULTS).toContain('api.scenarios.subscriptionOps.move')
    expect(V8_RESULTS).toContain("'失敗を再送'")
    expect(V8_RESULTS).toContain("'別のシナリオへ移す'")
    // 確認キー（Idempotency-Key）は購読ごとの署名で持つ。
    expect(V8_RESULTS).toContain('IdempotencyKeyStore')
    // pauseReason で「再開」と「失敗を再送」を出し分ける。
    expect(V8_RESULTS).toContain("sub.pauseReason === 'delivery_failed'")
  })

  it('取得失敗・未取得・0件を分けて出す（SCENARIO-10）', () => {
    expect(V8_RESULTS).toContain("runsState === 'idle'")
    expect(V8_RESULTS).toContain("runsState === 'loading'")
    expect(V8_RESULTS).toContain("runsState === 'error'")
    expect(V8_RESULTS).toContain('購読している友だちはまだいません')
  })
})

describe('★V8 シナリオの CSS モジュールの契約', () => {
  it('新しい CSS Module は layer 宣言から始める', () => {
    expect(V8_DETAIL_CSS.startsWith('@layer properties, theme, base, components, utilities;')).toBe(true)
    expect(V8_RESULTS_CSS.startsWith('@layer properties, theme, base, components, utilities;')).toBe(true)
  })

  it('v7 に効かせる指定を持たない（data-theme セレクタの直書きは無い）', () => {
    /*
     * V8 の画面は component 側の分岐でだけ出るので、CSS 側で
     * [data-theme] を条件にする必要は無い。付いていたら v7 の
     * 見た目へ漏れ出す危険があるので契約で止める。
     */
    expect(V8_DETAIL_CSS).not.toContain('[data-theme')
    expect(V8_RESULTS_CSS).not.toContain('[data-theme')
  })
})
