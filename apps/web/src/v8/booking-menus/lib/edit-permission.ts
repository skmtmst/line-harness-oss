import { usePermissionAccess } from '@/lib/use-feature-access'

/** 役割と鍵は共通のサーバー確認から判定する。確認中は操作を隠す。 */
export const useBookingEdit = usePermissionAccess
