/*
 * 「管理画面の更新」欄の出し方を 1 か所で決める(OPERATIONS-01)。
 *
 * 以前は説明文が「新しい10件」と書きながら `.slice(0, 4)` で4件しか
 * 出さず、5件目以降への案内もなかった。表示件数を定数にして、
 * 案内文・絞り込み・「続きがあります」の表示をこの定数で揃える。
 *
 * また、更新履歴ファイルの「unreleased」(まだ画面に入っていない変更)の
 * 行が配備済みの変更と同じ欄に並んでいた。「管理画面へ入った変更」と
 * 名乗る以上、未配備のものは行から外し、件数だけ別に返す。
 */
import type { OperationHistoryEntry } from '@/lib/api'

/** 「管理画面の更新」欄で一度に見せる件数。説明文と処理の両方がこれを使う。 */
export const RECENT_UPDATES_LIMIT = 10

/** 更新履歴ファイル(release-log)の1版ぶん。 */
export interface UpdateRelease {
  version: string
  released: string | null
  /**
   * この版の行数。画面が読む要約（release-log-summary.json）では、
   * 本文（entries）を新しい行だけに削り、行数はここで持つ。
   * 無いとき（全文を渡したとき）は entries の数がそのまま行数。
   */
  entryCount?: number
  entries: Array<{
    kind: string
    text: string
    by: string | null
    pr: number | null
    at: string | null
  }>
}

/** 版の行数。要約なら entryCount、全文なら entries の数。 */
export function releaseEntryCount(release: UpdateRelease): number {
  return release.entryCount ?? release.entries.length
}

/** 「管理画面の更新」欄の1行。配備記録と更新履歴ファイルの項目を同じ形にする。 */
export interface UpdateRow {
  kind: string
  text: string
  by: string | null
  pr: number | null
  at: string | null
  version: string
  released: string | null
}

/**
 * 配備の記録と更新履歴ファイルの項目を、新しい順の1つの並びにする。
 *
 * `released` が null の版(未配備の変更)は行に含めず、件数だけ
 * `pendingCount` へ返す。行に混ぜると「更新回数」カードと表示行が
 * 食い違って見え、まだ入っていない変更を配備済みと読み違える。
 */
export function collectRecentUpdates(
  deployments: OperationHistoryEntry[],
  releases: UpdateRelease[],
): { updates: UpdateRow[]; pendingCount: number; totalCount: number } {
  const deploymentRows: UpdateRow[] = deployments.map((entry) => ({
    kind: 'deployment',
    text: entry.reason,
    by: entry.deployment?.actor ?? entry.actorId,
    pr: entry.deployment?.pullRequest ?? null,
    at: entry.occurredAt ?? entry.createdAt,
    version: entry.deployment?.version ?? entry.deployment?.environment ?? '—',
    released: entry.occurredAt ?? entry.createdAt,
  }))
  const releaseRows: UpdateRow[] = []
  let pendingCount = 0
  // 本文が削られていても「続きが何件あるか」を数えられるよう、行数は版の行数で数える。
  let releasedCount = 0
  for (const release of releases) {
    if (!release.released) {
      pendingCount += releaseEntryCount(release)
      continue
    }
    releasedCount += releaseEntryCount(release)
    for (const entry of release.entries) {
      releaseRows.push({ ...entry, version: release.version, released: release.released })
    }
  }
  const updates = [...deploymentRows, ...releaseRows].toSorted(
    (left, right) => Date.parse(right.at ?? right.released ?? '') - Date.parse(left.at ?? left.released ?? ''),
  )
  return { updates, pendingCount, totalCount: deploymentRows.length + releasedCount }
}
