import { StaffV8, StaffEditV8 } from '@/v8/settings/public/staff-staff/index'
import { useListLocation } from '@/components/shared/list-url-state'
/** 実物の一覧の行から、実物の編集入口へ移る。 */
export default function StaffTestRoutes() {
  const location = useListLocation()
  return location.startsWith('/staff/edit') ? <StaffEditV8 /> : <StaffV8 />
}
