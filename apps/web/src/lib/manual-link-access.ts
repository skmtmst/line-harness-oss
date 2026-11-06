type ManualLinkStaff = {
  id?: string | null
  role?: string | null
  permissionKeys?: string[] | null
  readOnly?: boolean
  roleBundle?: string | null
} | null

/** 表を見る範囲は保ち、閲覧のみの指定は変更操作にだけ適用する。 */
export function canViewManualLinks(staff: ManualLinkStaff): boolean {
  return !!staff && (staff.id === 'env-owner' || (staff.permissionKeys ?? []).includes('manual.link.edit') || staff.role === 'owner')
}

export function canEditManualLinks(staff: ManualLinkStaff): boolean {
  return canViewManualLinks(staff) && !staff?.readOnly && staff?.roleBundle !== 'view_only' && staff?.role !== 'viewer'
}
