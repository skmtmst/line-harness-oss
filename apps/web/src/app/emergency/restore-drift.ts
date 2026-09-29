import type {
  OperationCapability,
  OperationRestoreDrift,
  OperationRestoreReport,
} from '@/lib/api'

/*
 * N-451: 復旧前検査（drift）を運用者向けの文言へ変える。
 *
 * 口は機械的な kind（changed/deleted/inactive/added/expired）と件数だけ返し、
 * 文言は画面側が持つ。帯・確認・履歴で同じ言い方を使うためここに置く。
 */

export const CAPABILITY_LABEL: Record<OperationCapability, string> = {
  broadcast_dispatch: '予約中の一斉配信',
  scenario_dispatch: 'シナリオ配信',
  reminder_dispatch: 'リマインダ',
  automation_actions: 'オートメーション',
  auto_reply_dispatch: '自動応答',
  webhook_outgoing: '外部への通知',
  ad_postback: '広告への成果通知',
}

const DRIFT_KIND_LABEL: Record<string, string> = {
  changed: '編集',
  deleted: '削除',
  inactive: '停止・送信済み',
  added: '追加',
  expired: '期限切れ',
}

function countByKind(entries: { kind: string }[], kind: string): number {
  return entries.filter((entry) => entry.kind === kind).length
}

/** capabilityごとのずれを「予約中の一斉配信: 編集2件・追加1件」の1行にする。 */
export function describeCapabilityDrift(capability: OperationCapability, entries: { kind: string }[]): string {
  const parts = (['changed', 'added', 'expired', 'deleted', 'inactive'] as const)
    .map((kind) => ({ kind, count: countByKind(entries, kind) }))
    .filter(({ count }) => count > 0)
    .map(({ kind, count }) => `${DRIFT_KIND_LABEL[kind]}${count}件`)
  return `${CAPABILITY_LABEL[capability]}: ${parts.join('・')}`
}

/** 復旧前検査全体を、止まる理由の行の並びにする。 */
export function describeRestoreDrift(drift: OperationRestoreDrift): string[] {
  const lines: string[] = []
  if (drift.accountInactive) {
    lines.push('対象アカウントが無効化・整理されているため、どれも再開できません。')
  }
  for (const capability of drift.capabilities) {
    if (capability.drift.length === 0) continue
    lines.push(describeCapabilityDrift(capability.capability, capability.drift))
  }
  return lines
}

/** 再開を止めた理由だけを抜き出す（blocked応答用）。 */
export function describeRestoreBlockers(drift: OperationRestoreDrift): string[] {
  const lines: string[] = []
  if (drift.accountInactive) {
    lines.push('対象アカウントが無効化・整理されているため、どれも再開できません。')
  }
  for (const capability of drift.capabilities) {
    if (!capability.blocked) continue
    const blocking = capability.drift.filter((entry) => entry.kind === 'changed' || entry.kind === 'added')
    if (blocking.length > 0) {
      lines.push(`${describeCapabilityDrift(capability.capability, blocking)}のため再開を止めました。`)
    } else if (drift.accountInactive) {
      lines.push(`${CAPABILITY_LABEL[capability.capability]}はアカウントの状態のため再開を止めました。`)
    }
  }
  return lines
}

/** 復旧の結果メッセージ。一部だけ戻った・期限切れを下書きへ戻した場合も伝える。 */
export function describeRestoreResult(report: OperationRestoreReport): { tone: 'success' | 'warning'; text: string } {
  const heldCount = report.heldExpired.length
  const heldText = heldCount > 0 ? `期限を過ぎた予約${heldCount}件は下書きへ戻しました。` : ''
  if (report.remaining.length === 0) {
    return {
      tone: 'success',
      text: `サーバー共通の停止状態を復旧しました。${heldText || '期限を過ぎた予約は自動では送りません。'}`,
    }
  }
  const remaining = report.remaining.map((capability) => CAPABILITY_LABEL[capability]).join('・')
  return {
    tone: 'warning',
    text: `一部だけ復旧しました。${remaining}は停止中の変更・追加があるため止めたままです。${heldText}`,
  }
}
