import type {
  AutoReplyConflict,
  AutoReplyDryRunResult,
  AutoReplyValidationResult,
} from '@line-crm/shared'

export type PublishStage = 'conflicts' | 'test' | 'confirm' | 'done'

export type GateState = 'ok' | 'blocked' | 'unknown'

export type PublishGate = {
  label: string
  state: GateState
  detail: string
}

/**
 * 公開までの4段（設計 `U9hzqH` → `g46ja` → `Yj6CQ` → `e6iJG`）。
 *
 * **本番のルールを書き換える手前の画面なので、押せる条件を明示する。**
 * 契約（#595）は「競合を全件確認し、試験で下書き自身が勝つまで公開しない」。
 * 画面もそれをそのまま出す。
 */
export function publishGates(
  validation: AutoReplyValidationResult | null,
  dryRun: AutoReplyDryRunResult | null,
  acknowledged: Set<string>,
): PublishGate[] {
  const conflicts = validation?.conflicts ?? []
  const unacknowledged = conflicts.filter((c) => !acknowledged.has(c.autoReplyId))

  return [
    {
      label: '競合をすべて確認しました',
      state: validation === null ? 'unknown' : unacknowledged.length === 0 ? 'ok' : 'blocked',
      detail:
        validation === null
          ? '—（未取得）競合を読み込めていません'
          : conflicts.length === 0
            ? '重なる自動応答はありません'
            : unacknowledged.length === 0
              ? `${conflicts.length}件を確認しました`
              : `${unacknowledged.length}件が未確認です`,
    },
    {
      label: '試験でこの下書きが返しました',
      state: dryRun === null ? 'unknown' : dryRun.draftWon ? 'ok' : 'blocked',
      detail:
        dryRun === null
          ? '—（未取得）まだ試していません'
          : dryRun.draftWon
            ? '実際の評価順で、この下書きが選ばれました'
            : `いまは「${dryRun.winner?.name ?? '別の自動応答'}」が先に返します`,
    },
    {
      label: '入力に不足がありません',
      state: validation === null ? 'unknown' : validation.errors.length === 0 ? 'ok' : 'blocked',
      detail:
        validation === null
          ? '—（未取得）確認できていません'
          : validation.errors.length === 0
            ? '足りない項目はありません'
            : validation.errors.join(' / '),
    },
  ]
}

/**
 * 公開してよいか。**1つでも `ok` でなければ押させない。**
 * `unknown`（確かめられていない）も押させない——**確かめていないものを
 * 確かめたように扱わない。**
 */
export function canPublish(gates: PublishGate[]): boolean {
  return gates.length > 0 && gates.every((g) => g.state === 'ok')
}

/** 競合の重さ。**「たぶん当たる」も落とさず、確かなものと分ける。** */
export function conflictTone(conflict: AutoReplyConflict, draftId: string): {
  label: string
  losing: boolean
} {
  const losing = conflict.winnerAutoReplyId !== draftId
  return {
    label: conflict.certainty === 'certain' ? '必ず重なります' : '重なることがあります',
    losing,
  }
}
