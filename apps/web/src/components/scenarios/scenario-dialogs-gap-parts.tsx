'use client'

import { type ScenarioFriendPlanStep } from '@/lib/api';


/* ------------------------------------------- 友だち別の配信予定（IDEA-05） */

/*
 * シナリオ確認（配信結果）の中で、選んだ検証顧客へ現在のシナリオが
 * どう配られるかを表示する。試算口（GET …/friends/:friendId/plan）は
 * 送信・購読登録・タグ更新を一切行わない。応答の sideEffects:false が
 * その証左なので、画面でも「送らない確認」だと断る。
 *
 * 予定の判定は配信処理と同じ関数を通る（条件分岐 evaluateCondition・
 * 絞り込み matchesCondition・日時 computeNextDeliveryAt）。配信時点の
 * 状態で結果が変わる条件は dynamic=true で返るので「未確定」と出し、
 * 確定した日時に見せない（NEXT-01〜04 の「確認が嘘をつかない」に揃える）。
 */

const FRIEND_PLAN_OUTCOME: Record<ScenarioFriendPlanStep['outcome'], string> = {
  deliver: '届く見通し',
  skip: '送らず次へ',
  branch: '条件で分岐',
  pause: 'この通のあと停止',
  undetermined: '未確定',
}


/** 予定1行。時刻が無い・動的条件で変わるものは「未確定」を添える。 */
function FriendPlanStepRow({ step }: { step: ScenarioFriendPlanStep }) {
  return (
    <li className="border-hairline border-b px-4 py-2.5 text-sm last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-ink shrink-0 font-medium tabular-nums">{step.stepOrder}通目</span>
        <span className="text-ink-secondary shrink-0 tabular-nums">
          {step.scheduledAt ?? '—'}
        </span>
        <span
          className={`rounded-pill shrink-0 border px-2 py-0.5 text-xs ${
            step.outcome === 'deliver'
              ? 'border-success bg-success-bg text-success'
              : step.outcome === 'branch' || step.outcome === 'pause'
                ? 'border-warning bg-warning-bg text-warning'
                : step.outcome === 'skip'
                  ? 'border-hairline text-ink-secondary'
                  : 'border-hairline text-ink-faint'
          }`}
        >
          {FRIEND_PLAN_OUTCOME[step.outcome]}
        </span>
        {step.dynamic ? (
          <span className="text-ink-faint shrink-0 text-xs">未確定</span>
        ) : null}
      </div>
      {step.reason ? (
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">{step.reason}</p>
      ) : null}
    </li>
  )
}
export { FRIEND_PLAN_OUTCOME, FriendPlanStepRow }
