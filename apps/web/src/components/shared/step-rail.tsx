'use client'

/**
 * 設計 `LMiL2` の段の進み表示。
 *
 * **一斉配信だけのものではない。** 設計は15枚の作成画面に同じ帯を置いている
 * ——リマインダ・自動応答・友だち追加時・ウェビナー・リッチメニュー・シナリオ。
 * `components/broadcasts/` に置いていたので配信でしか使えず、
 * ほかの14枚には帯が無いままだった。
 *
 * 実装の作成画面は1枚の長い画面なので、段を押すとその節へ飛ぶ。
 * **段だけ描いて飛べないと、上に帯があるのに何もできない飾りになる。**
 */

export type StepState = 'done' | 'current' | 'todo'

export interface RailStep {
  key: string
  /** 設計の「STEP 1」。1始まり。 */
  order: number
  label: string
  /** 押したときに飛ぶ節の id。 */
  anchor: string
  state: StepState
}

export default function StepRail({
  steps,
  ariaLabel,
}: {
  steps: ReadonlyArray<RailStep>
  /** 「配信作成の進み」のように、何の進みかを言う。 */
  ariaLabel: string
}) {
  return (
    <nav aria-label={ariaLabel} className="border-hairline bg-canvas rounded-card mb-4 border p-4">
      <ol className="flex flex-wrap items-center gap-y-3">
        {steps.map((step, index) => (
          <li key={step.key} className="flex min-w-0 flex-1 items-center gap-3">
            {index > 0 && <span aria-hidden className="bg-hairline hidden h-px w-6 shrink-0 sm:block" />}
            <button
              type="button"
              onClick={() => document.getElementById(step.anchor)?.scrollIntoView({ block: 'start' })}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.state === 'done'
                    ? 'bg-accent-deep text-on-accent'
                    : step.state === 'current'
                      ? 'border-accent text-accent border-2'
                      : 'border-hairline text-ink-faint border'
                }`}
              >
                {step.state === 'done' ? '✓' : step.order}
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-xs font-bold tracking-wider ${
                    step.state === 'todo' ? 'text-ink-faint' : 'text-accent'
                  }`}
                >
                  STEP {step.order}
                </span>
                <span
                  className={`block truncate text-sm font-bold ${
                    step.state === 'todo' ? 'text-ink-faint' : 'text-ink'
                  }`}
                >
                  {step.label}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
