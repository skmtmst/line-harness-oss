import type { Broadcast } from '@line-crm/db';

/** 承認を調べた定義の版・状態のまま送信を開始する。判定後の編集・取消は409/次回待ち。 */
export const BROADCAST_DEFINITION_GUARD_SQL = "AND lock_version = ? AND COALESCE(approval_status,'none') = ?";
export function broadcastDefinitionGuardArgs(broadcast: Broadcast): [number, string] {
  const raw = broadcast as unknown as Record<string, unknown>;
  return [Number(broadcast.lock_version ?? 1), String(raw.approval_status ?? 'none')];
}
