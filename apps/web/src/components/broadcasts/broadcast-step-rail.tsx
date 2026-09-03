'use client'

import StepRail from '@/components/shared/step-rail'

import type { BroadcastStep } from './broadcast-steps'

/**
 * 一斉配信の5段の進み表示。
 *
 * 描くところは `shared/step-rail.tsx` に出した。**設計は同じ帯を15枚に置いている**
 * ので、配信の下に置いたままだとほかの機能から使えない。
 * ここは配信の段（`BroadcastStep`）を共通部品へ渡すだけにする。
 */
export default function BroadcastStepRail({ steps }: { steps: BroadcastStep[] }) {
  return <StepRail steps={steps} ariaLabel="配信作成の進み" />
}
