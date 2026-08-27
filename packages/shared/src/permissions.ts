/** 高危険な緊急停止・復旧を通常の画面権限から分離する操作permission。 */
export const EMERGENCY_CONTROL_PERMISSION = 'action:emergency-control';

export function canControlEmergency(
  role: 'owner' | 'admin' | 'staff' | 'viewer' | string | null | undefined,
  permissionKeys: readonly string[] | null | undefined,
): boolean {
  if (role === 'owner') return true;
  return role === 'admin' && Boolean(permissionKeys?.includes(EMERGENCY_CONTROL_PERMISSION));
}
