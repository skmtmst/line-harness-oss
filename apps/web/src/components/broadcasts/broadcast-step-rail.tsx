'use client'

import Button from '@/components/shared/button'
import StepRail from '@/components/shared/step-rail'

import type { BroadcastStep } from './broadcast-steps'

/**
 * 一斉配信の5段の進み表示。
 *
 * 描くところは `shared/step-rail.tsx` に出した。**設計は同じ帯を15枚に置いている**
 * ので、配信の下に置いたままだとほかの機能から使えない。
 * ここは配信の段（`BroadcastStep`）を共通部品へ渡すだけにする。
 *
 * #973 U048: 5段をそのまま狭い幅へ押し込むと「STEP」・番号・段名が
 * 折り返し・省略で読めなくなる。狭い幅では「いま何段目か」「全部で
 * 何段か」「前後へ移動」だけに絞った表示へ切り替える。
 */
export default function BroadcastStepRail({ steps }: { steps: BroadcastStep[] }) {
  const currentIndex = steps.findIndex((step) => step.state === 'current')
  // 全部 done のとき（送信直前）は最後の段を現在地として出す。
  const activeIndex = currentIndex === -1 ? Math.max(steps.length - 1, 0) : currentIndex
  const current = steps[activeIndex]
  const previous = steps[activeIndex - 1]
  const next = steps[activeIndex + 1]

  const jumpTo = (anchor: string) =>
    document.getElementById(anchor)?.scrollIntoView({ block: 'start' })

  return (
    <>
      {/* 狭い幅向け: いまの段・全体の位置・前後への移動だけを出す。 */}
      {current ? (
        <nav
          aria-label="配信作成の進み"
          className="border-hairline bg-canvas rounded-card mb-4 border p-4 sm:hidden"
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="min-w-0">
              <span className="text-accent block text-xs font-bold tracking-wider">
                STEP {current.order} / {steps.length}
              </span>
              <span className="text-ink block truncate text-sm font-bold" title={current.label}>
                {current.label}
              </span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="field"
                onClick={() => previous && jumpTo(previous.anchor)}
                disabled={!previous}
              >
                前へ
              </Button>
              <Button
                type="button"
                size="field"
                onClick={() => next && jumpTo(next.anchor)}
                disabled={!next}
              >
                次へ
              </Button>
            </div>
          </div>
        </nav>
      ) : null}
      {/* 広い幅ではこれまでどおり5段の帯を出す。 */}
      <div className="hidden sm:block">
        <StepRail steps={steps} ariaLabel="配信作成の進み" />
      </div>
    </>
  )
}
