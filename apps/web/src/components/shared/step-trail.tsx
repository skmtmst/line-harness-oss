import React from 'react'
import Stepper from './stepper'
import type { StepState } from './stepper'

export type { StepState }

export type StepTrailItem = {
  label: string
  state: StepState
}

/**
 * 何段のうちの何段目かを出す（StepTrail 互換の入口）。
 *
 * 中身は共通の Stepper に任せる。呼び出し方は変えないので、
 * 使っている画面はそのまま動く。
 */
export default function StepTrail({
  label,
  items,
}: {
  /** 読み上げ用の名前。「◯◯の進み方」。 */
  label: string
  items: StepTrailItem[]
}) {
  return (
    <Stepper
      label={label}
      steps={items.map((item, index) => ({
        key: item.label,
        label: item.label,
        order: index + 1,
        state: item.state,
      }))}
    />
  )
}
