'use client'

import React from 'react'

export type StepperState = 'done' | 'current' | 'todo'

/** 旧名。Stepper に寄せたので、新しくは StepperState を使う。 */
export type StepState = StepperState

export interface StepperStep {
  key: string
  label: string
  /** 1始まりの表示番号。 */
  order: number
  state: StepperState
  /** 押したときに飛ぶ節の id（StepRail 互換）。済みの段だけに付ける。 */
  anchor?: string
  /** anchor の代わりに押したときの動き。済みの段だけに付ける。 */
  onSelect?: () => void
}

/**
 * 手順の進み表示（★V7 共通部品その2 `uR9s8` §4）。
 * StepRail と StepTrail を1本にしたもの。
 *
 * - 済みはチェック（緑の丸＋白の ✓）
 * - 今は濃い緑の丸＋番号
 * - まだは灰色の丸＋番号
 * - 押して戻れるのは済みの段だけ（いま・まだは飾りでなく本文の案内に従う）
 */
export default function Stepper({
  steps,
  label,
}: {
  /** 何の進みか（例：「配信作成の進み」）。nav の読み上げ名。 */
  label: string
  steps: ReadonlyArray<StepperStep>
}) {
  return (
    <nav aria-label={label} className="border-hairline bg-canvas rounded-card mb-4 border p-4">
      <ol data-design="Steps" aria-label={label} className="flex flex-wrap items-center gap-y-3">
        {steps.map((step, index) => {
          const clickable = step.state === 'done' && (step.anchor || step.onSelect)
          const circle = (
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.state === 'done'
                  ? 'bg-accent-deep text-on-accent'
                  : step.state === 'current'
                    ? 'bg-accent-deep text-on-accent'
                    : 'border-hairline text-ink-faint border'
              }`}
            >
              {step.state === 'done' ? '✓' : step.order}
            </span>
          )
          const text = (
            <span className="min-w-0">
              <span
                className={`block truncate text-sm font-bold ${
                  step.state === 'todo' ? 'text-ink-faint' : 'text-ink'
                }`}
              >
                {step.label}
              </span>
            </span>
          )
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center gap-3">
              {index > 0 ? (
                <span
                  aria-hidden
                  className={`hidden h-px w-6 shrink-0 sm:block ${
                    steps[index - 1].state === 'done' ? 'bg-accent-deep' : 'bg-hairline'
                  }`}
                />
              ) : null}
              {clickable ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step.onSelect) {
                      step.onSelect()
                      return
                    }
                    if (step.anchor) {
                      document.getElementById(step.anchor)?.scrollIntoView({ block: 'start' })
                    }
                  }}
                  aria-label={`${step.label}へ戻る`}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  {circle}
                  {text}
                </button>
              ) : (
                <span
                  className="flex min-w-0 items-center gap-2"
                  aria-current={step.state === 'current' ? 'step' : undefined}
                >
                  {circle}
                  {text}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
