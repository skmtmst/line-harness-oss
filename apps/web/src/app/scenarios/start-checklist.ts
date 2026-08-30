import type { Scenario } from '@line-crm/shared'

export type StartCheckState = 'ok' | 'warn' | 'unknown'

export type StartCheckItem = {
  label: string
  state: StartCheckState
  /** 状態の理由。`unknown` のときは「なぜ確かめられないか」を書く。 */
  detail: string
}

type ScenarioForCheck = Pick<Scenario, 'triggerType'> & {
  stepCount?: number
  subscriberCount?: number
}

/**
 * 配信を始める前の確認（設計 `RUxNf`）。
 *
 * 設計は4項目を並べる。**このうち画面が確かめられるのは2つだけ**なので、
 * 残り2つは `unknown` にして「—（未取得）」と、なぜ確かめられないかを書く。
 * **取得元の無い項目を「確認済み」と書かない。** 押したあとに戻せない操作なので、
 * 確かめていないことを確かめたように見せるのがいちばん危ない。
 *
 * - 開始条件：`triggerType` があるかで分かる
 * - 配信タイミング：通が1つ以上あるかで分かる（0通なら誰にも届かない）
 * - テスト送信：**記録を持っていない**ので `unknown`
 * - 送信枠：**LINE側の残枠を読む口がこの画面に無い**ので `unknown`
 */
export function startChecklist(scenario: ScenarioForCheck): StartCheckItem[] {
  const steps = scenario.stepCount

  return [
    {
      label: '開始条件が設定されています',
      state: scenario.triggerType ? 'ok' : 'warn',
      detail: scenario.triggerType
        ? 'きっかけが決まっています'
        : 'きっかけが決まっていません。編集画面で選んでください',
    },
    {
      label: 'すべての通に配信タイミングがあります',
      state: steps === undefined ? 'unknown' : steps > 0 ? 'ok' : 'warn',
      detail:
        steps === undefined
          ? '—（未取得）通数を確認できませんでした'
          : steps > 0
            ? `${steps}通あります`
            : '通が1つもありません。1通以上入れてください',
    },
    {
      label: 'テスト送信が終わっています',
      state: 'unknown',
      detail: '—（未取得）テスト送信の記録を持っていません',
    },
    {
      label: 'LINE公式の送信枠を超えていません',
      state: 'unknown',
      detail: '—（未取得）残りの送信枠をこの画面から確認できません',
    },
  ]
}

/** 止める側では出さない。開始のときだけ確認する。 */
export function shouldShowStartChecklist(isActive: boolean): boolean {
  return !isActive
}
