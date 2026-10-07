import type { CommonActionStep } from '@/lib/api'
/* 写し：app/common-actions/action-order.ts（src/v8 は古い画面ファイルを import できない）。 */

/*
 * 監査 R474: 通常処理と分岐は1本の順序付きリスト。編集画面では通常処理と
 * 分岐を別々に並べるが、通常処理の編集で分岐が末尾へ移動して保存される
 * 問題があった。分岐の位置（添字）を保ち、空いた枠を編集後の順に詰める。
 *
 * - 値だけの変更：順序は完全に保持される
 * - 削除：詰めて分岐の相対位置を保つ
 * - 追加・並べ替え：編集側の順序を枠に流し込む。分岐は動かさない
 *   （分岐をまたぐ移動はこの画面ではできない。順序変更は明示操作に限る）
 */
export function mergeOrderedActions(
  current: CommonActionStep[],
  nextPlain: CommonActionStep[],
): CommonActionStep[] {
  const branchAt = new Set<number>()
  current.forEach((step, index) => {
    if (step.type === 'branch') branchAt.add(index)
  })
  const queue = [...nextPlain]
  const merged: CommonActionStep[] = []
  for (let index = 0; index < current.length; index++) {
    if (branchAt.has(index)) {
      merged.push(current[index])
      continue
    }
    const next = queue.shift()
    if (next) merged.push(next)
  }
  // 編集側で足された分は末尾へ。
  merged.push(...queue)
  return merged
}

/* 全体の実行順での番号表。分岐の見出しと通常処理の番号を一致させる。 */
export function stepNumbers(steps: CommonActionStep[]): Record<string, number> {
  const numbers: Record<string, number> = {}
  steps.forEach((step, index) => {
    numbers[step.id] = index + 1
  })
  return numbers
}
