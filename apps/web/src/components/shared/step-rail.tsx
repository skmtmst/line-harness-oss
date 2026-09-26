'use client'

import Stepper from './stepper'
import type { StepState } from './stepper'

export type { StepState }
export type { StepperStep as RailStep } from './stepper'

/**
 * 設計 `LMiL2` の段の進み表示（StepRail 互換の入口）。
 *
 * 中身は共通の Stepper に任せる。呼び出し方は変えないので、
 * 使っている15枚の作成画面はそのまま動く。
 */
export default function StepRail({
  steps,
  ariaLabel,
}: {
  steps: ReadonlyArray<{
    key: string
    /** 設計の「STEP 1」。1始まり。 */
    order: number
    label: string
    /** 押したときに飛ぶ節の id。 */
    anchor: string
    state: StepState
  }>
  /** 「配信作成の進み」のように、何の進みかを言う。 */
  ariaLabel: string
}) {
  return (
    <Stepper
      label={ariaLabel}
      steps={steps.map((step) => ({
        ...step,
        onSelect: () => document.getElementById(step.anchor)?.scrollIntoView({ block: 'start' }),
      }))}
    />
  )
}
