/*
 * 1通目設定（設計 `V6 5 kk8dz`）の契約。
 *
 * 本体は、上限を超えた本文のまま保存を押せないこと。押せたところでLINEが
 * 弾くので、画面は「保存できたのに届かない」を作ることになる。
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(new URL('../../../v8/scenario-first-step/first-step.tsx', import.meta.url), 'utf8')
const COMPONENTS = path.join(__dirname, '..', '..', '..', 'components', 'scenarios')
const PREVIEW = fs.readFileSync(path.join(COMPONENTS, 'step-preview.tsx'), 'utf8')

describe('1通目設定の動きの契約', () => {
  it('作成の現在地と保存前の要点を同時に確認できる', () => {
    // B-6: 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
    expect(PREVIEW).toContain('<LinePreview')
    // R213: 通番号は変数で出す（2通目以降の編集で正しい番号になる）。
    // 新規1通目の既定は 1 のままなので、ここの見た目は変わらない。
    // R235: 時刻未設定の分岐が入ったが、通番号は両方の枝で変数のまま。
    expect(PREVIEW).toContain('${stepLabel}')
    expect(PREVIEW).toContain('stepOrder = 1')
    expect(PREVIEW).toContain('設定サマリー')
  })

  it('本文は手動でも広げられ、「本文」の字が入力欄と結び付く', () => {
    expect(PAGE).not.toContain('resize-none')
    // ラベルを押すと入力欄へ移る（UX-01 / U087）。
    expect(PAGE).toContain("id=\"first-step-body\"")
    expect(PAGE).toContain('id="first-step-body"')
  })

  it('本文の文字数を出す', () => {
    expect(PAGE).toContain('const bodyLength = countTemplateTextCharacters(body)')
    expect(PAGE).toContain('count={`${formatNumber(bodyLength)} / ${formatNumber(LINE_TEXT_LIMIT)}`}')
  })

  it('作成途中へ戻ったときは既存の1通目を表示し、重複追加せず更新する', () => {
    expect(PAGE).toContain('restoreFirstStep(first')
    expect(PAGE).toContain('setExistingStepId(restored.existingStepId)')
    expect(PAGE).toContain('api.scenarios.updateStep(id, existingStepId, stepPayload)')
    expect(PAGE).toContain('api.scenarios.addStep(id, stepPayload)')
  })

  it('シナリオが確定するまで保存できない', () => {
    // SCENARIO-04：取得待ち・取得失敗のまま保存を押せると、まだ知らない
    // 既存の1通目へ重ねて追加してしまう。
    expect(PAGE).toContain("useState<LoadState>('idle')")
    expect(PAGE).toContain("setLoadState('ready')")
    expect(PAGE).toContain("setLoadState('error')")
    expect(PAGE).toContain('loadState !== \'ready\'')
    // 再読み込みは ★V7 TargetMissing の error（onRetry が番号を進めて取り直す）。
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('onRetry={() => setReloadKey((k) => k + 1)}')
  })

  it('保存の失敗・切断で「保存中」のままにしない', () => {
    // SCENARIO-05：例外でも finally で busy を戻し、入力を残して再試行できる。
    expect(PAGE).toContain('} catch (submitError) {')
    expect(PAGE).toContain('setSaving(false)')
  })

  it('上限を超えた本文では保存を押せなくし、理由を本文に出す', () => {
    expect(PAGE).toContain('const bodyOverLimit =')
    expect(PAGE).toContain('isOverCharLimit(bodyLength, LINE_TEXT_LIMIT)')
    expect(PAGE).toContain("disabled={saving || bodyOverLimit}")
    expect(PAGE).toContain("if (saving || bodyOverLimit || loadState !== 'ready' || !scenario) return")
  })
})
