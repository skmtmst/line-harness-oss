import type { OperationControl } from '@/lib/api'

export type OperationControlSummary = { value: string; note: string }

export function operationControlSummary(
  control: Pick<OperationControl, 'activeIncidentId' | 'reason'>,
): OperationControlSummary {
  return control.activeIncidentId
    ? { value: '停止中', note: control.reason || '停止理由は未入力です' }
    : { value: '通常運用', note: '停止なし' }
}
