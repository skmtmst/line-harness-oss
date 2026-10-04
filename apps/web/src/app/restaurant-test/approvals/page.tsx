'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import ApprovalsV8 from '../v8/approvals'

/* ★V8 切替（板 `t8WgD8`）。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <ApprovalsV8 /> : <RestaurantConsole view="approvals" />
}
