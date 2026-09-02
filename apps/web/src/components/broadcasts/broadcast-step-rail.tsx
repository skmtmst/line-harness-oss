'use client'

import type { BroadcastStep } from './broadcast-steps'

/**
 * 設計 `LMiL2` の5段の進み表示。
 *
 * 実装の作成画面は1枚の長い画面なので、段を押すとその節へ飛ぶ。
 * **段だけ描いて飛べないと、上に帯があるのに何もできない飾りになる。**
 */
export default function BroadcastStepRail({ steps }: { steps: BroadcastStep[] }) {
  return (
    <nav aria-label="配信作成の進み" className="border-hairline bg-canvas rounded-card mb-4 border p-4">
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
                    ? 'bg-accent text-on-accent'
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
